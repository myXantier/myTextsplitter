//! Bounded "latest job wins" execution of the CPU-heavy text commands (Split, Filter, Remove, Diff).
//!
//! Per operation there is one [`JobSlot`] with **at most one running and at most one waiting job**:
//! - The running job executes on Tokio's blocking pool. It cannot be stopped (a running regex has no
//!   cancellation point); its result is still delivered and the frontend discards it if it is outdated.
//! - A new job replaces the waiting one. The replaced job never runs: its input is dropped at once and its
//!   caller receives `TextError::Superseded`.
//! - Waiting happens in the async command future (a channel receive), not in a blocking thread. One blocking
//!   thread per operation runs the jobs one after the other and ends when no job is waiting.
//!
//! So per operation there are at most two input copies (running + waiting) and at most one blocking thread,
//! however many requests arrive. Different operations have their own slot and do not block each other.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, MutexGuard};

use tauri::async_runtime::{channel, Sender};

use crate::text_processor::TextError;

type Job<T> = Box<dyn FnOnce() -> Result<T, TextError> + Send>;

struct Waiting<T> {
    job: Job<T>,
    reply: Sender<Result<T, TextError>>,
}

struct SlotState<T> {
    /// A blocking thread is running jobs of this slot.
    running: bool,
    waiting: Option<Waiting<T>>,
}

pub struct JobSlot<T> {
    state: Mutex<SlotState<T>>,
}

impl<T: Send + 'static> JobSlot<T> {
    pub const fn new() -> Self {
        JobSlot { state: Mutex::new(SlotState { running: false, waiting: None }) }
    }

    /// The state is only held for short updates (no job runs under the lock); a poisoned lock is used further.
    fn state(&self) -> MutexGuard<'_, SlotState<T>> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Runs `job` as the latest job of this slot. Resolves with its result, or with `TextError::Superseded`
    /// if a newer job replaced it before it started.
    pub async fn run<F>(&'static self, job: F) -> Result<T, TextError>
    where
        F: FnOnce() -> Result<T, TextError> + Send + 'static,
    {
        let (reply, mut result) = channel(1);
        let start_runner = {
            let mut state = self.state();
            if let Some(replaced) = state.waiting.replace(Waiting { job: Box::new(job), reply }) {
                // Not started yet: it never runs, its input is dropped here
                let _ = replaced.reply.try_send(Err(TextError::Superseded));
            }
            !std::mem::replace(&mut state.running, true)
        };
        if start_runner {
            // No await on the handle: the runner reports every result through the job's channel
            let _ = tauri::async_runtime::spawn_blocking(move || self.run_waiting_jobs());
        }
        result
            .recv()
            .await
            .unwrap_or_else(|| Err(TextError::Internal("text processing job ended without result".into())))
    }

    /// Blocking runner: takes the waiting job until there is none. A panicking job is reported as
    /// `TextError::Internal` and does not stop the runner (later jobs are not blocked).
    fn run_waiting_jobs(&self) {
        loop {
            let Waiting { job, reply } = {
                let mut state = self.state();
                match state.waiting.take() {
                    Some(waiting) => waiting,
                    None => {
                        state.running = false;
                        return;
                    }
                }
            };
            let result = catch_unwind(AssertUnwindSafe(job))
                .unwrap_or_else(|_| Err(TextError::Internal("text processing job panicked".into())));
            let _ = reply.try_send(result);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::async_runtime::{block_on, spawn};

    const WAIT: Duration = Duration::from_secs(5);

    /// A job that signals its start and then blocks until it is released (a long running regex).
    fn blocking_job(started: mpsc::Sender<()>, release: mpsc::Receiver<()>, value: u32) -> impl FnOnce() -> Result<u32, TextError> + Send + 'static {
        move || {
            started.send(()).unwrap();
            release.recv_timeout(WAIT).map_err(|_| TextError::Internal("not released".into()))?;
            Ok(value)
        }
    }

    /// Submits `future` (its first poll registers the job in the slot), then lets the runtime finish it.
    /// Keeps the submission order deterministic; `spawn` alone may poll the tasks in any order.
    fn submit<F: std::future::Future + Send + 'static>(future: F) -> tauri::async_runtime::JoinHandle<F::Output>
    where
        F::Output: Send + 'static,
    {
        let mut future = Box::pin(future);
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        assert!(future.as_mut().poll(&mut context).is_pending(), "the job waits for its result");
        spawn(future)
    }

    #[test]
    fn many_requests_of_one_type_run_only_the_running_and_the_latest_job() {
        static SLOT: JobSlot<u32> = JobSlot::new();
        static EXECUTED: AtomicUsize = AtomicUsize::new(0);
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();

        let first = submit(SLOT.run(blocking_job(started_tx, release_rx, 0)));
        started_rx.recv_timeout(WAIT).expect("first job started");

        // 50 requests while the first one runs: each one replaces the waiting one
        let requests: Vec<_> = (1..=50u32)
            .map(|i| {
                submit(SLOT.run(move || {
                    EXECUTED.fetch_add(1, Ordering::SeqCst);
                    Ok(i)
                }))
            })
            .collect();
        {
            let state = SLOT.state();
            assert!(state.running && state.waiting.is_some(), "one running, exactly one waiting job");
        }

        release_tx.send(()).unwrap();
        assert_eq!(block_on(first).unwrap(), Ok(0), "the running job cannot be stopped and delivers its result");
        let results: Vec<_> = requests.into_iter().map(|r| block_on(r).unwrap()).collect();
        for (i, result) in results.iter().enumerate().take(49) {
            assert_eq!(result, &Err(TextError::Superseded), "request {} was outdated before it started", i + 1);
        }
        assert_eq!(results[49], Ok(50), "the latest request is processed");
        assert_eq!(EXECUTED.load(Ordering::SeqCst), 1, "outdated requests never ran");
        wait_until_idle(&SLOT);
    }

    /// The runner clears `running` right after delivering the last result.
    fn wait_until_idle<T: Send + 'static>(slot: &'static JobSlot<T>) {
        let end = std::time::Instant::now() + WAIT;
        while slot.state().running {
            assert!(std::time::Instant::now() < end, "the runner did not end");
            std::thread::yield_now();
        }
        assert!(slot.state().waiting.is_none());
    }

    #[test]
    fn a_superseded_job_drops_its_input_at_once() {
        static SLOT: JobSlot<u32> = JobSlot::new();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first = submit(SLOT.run(blocking_job(started_tx, release_rx, 0)));
        started_rx.recv_timeout(WAIT).unwrap();

        let input = std::sync::Arc::new("large input text".to_string());
        let held = input.clone();
        let outdated = submit(SLOT.run(move || Ok(held.len() as u32)));
        assert_eq!(std::sync::Arc::strong_count(&input), 2, "the waiting job holds its input");
        let latest = submit(SLOT.run(|| Ok(7)));
        assert_eq!(std::sync::Arc::strong_count(&input), 1, "replaced before it started: input dropped");
        assert_eq!(block_on(outdated).unwrap(), Err(TextError::Superseded), "superseded at once, not after the running job");

        release_tx.send(()).unwrap();
        assert_eq!(block_on(first).unwrap(), Ok(0));
        assert_eq!(block_on(latest).unwrap(), Ok(7));
        wait_until_idle(&SLOT);
    }

    #[test]
    fn at_most_one_job_runs_and_one_waits_per_slot() {
        static SLOT: JobSlot<u32> = JobSlot::new();
        static ACTIVE: AtomicUsize = AtomicUsize::new(0);
        static MAX_ACTIVE: AtomicUsize = AtomicUsize::new(0);

        let requests: Vec<_> = (0..20u32)
            .map(|i| {
                spawn(SLOT.run(move || {
                    let active = ACTIVE.fetch_add(1, Ordering::SeqCst) + 1;
                    MAX_ACTIVE.fetch_max(active, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(5));
                    ACTIVE.fetch_sub(1, Ordering::SeqCst);
                    Ok(i)
                }))
            })
            .collect();
        let results: Vec<_> = requests.into_iter().map(|r| block_on(r).unwrap()).collect();
        assert_eq!(MAX_ACTIVE.load(Ordering::SeqCst), 1, "one computation at a time");
        assert!(results.iter().all(|r| r.is_ok() || r == &Err(TextError::Superseded)));
        assert!(results.iter().any(|r| r.is_ok()));
        wait_until_idle(&SLOT);
    }

    #[test]
    fn a_new_job_runs_after_the_running_one_without_extra_waiting() {
        static SLOT: JobSlot<u32> = JobSlot::new();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first = submit(SLOT.run(blocking_job(started_tx, release_rx, 1)));
        started_rx.recv_timeout(WAIT).unwrap();
        let second = submit(SLOT.run(|| Ok(2)));
        release_tx.send(()).unwrap();
        assert_eq!(block_on(first).unwrap(), Ok(1));
        assert_eq!(block_on(second).unwrap(), Ok(2));
    }

    #[test]
    fn different_slots_do_not_block_each_other() {
        static SLOT_A: JobSlot<u32> = JobSlot::new();
        static SLOT_B: JobSlot<u32> = JobSlot::new();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let a = submit(SLOT_A.run(blocking_job(started_tx, release_rx, 1)));
        started_rx.recv_timeout(WAIT).unwrap();
        assert_eq!(block_on(SLOT_B.run(|| Ok(2))), Ok(2), "B runs while A is still running");
        release_tx.send(()).unwrap();
        assert_eq!(block_on(a).unwrap(), Ok(1));
    }

    #[test]
    fn failing_and_panicking_jobs_do_not_block_later_jobs() {
        static SLOT: JobSlot<u32> = JobSlot::new();
        assert_eq!(block_on(SLOT.run(|| Err(TextError::RegexRuntime("limit".into())))), Err(TextError::RegexRuntime("limit".into())));
        let panicked = block_on(SLOT.run(|| panic!("job panicked")));
        assert!(matches!(panicked, Err(TextError::Internal(_))), "{panicked:?}");
        assert_eq!(block_on(SLOT.run(|| Ok(3))), Ok(3));
        wait_until_idle(&SLOT);
    }

    #[test]
    fn jobs_run_on_a_blocking_thread() {
        static SLOT: JobSlot<std::thread::ThreadId> = JobSlot::new();
        let caller = std::thread::current().id();
        assert_ne!(block_on(SLOT.run(|| Ok(std::thread::current().id()))).unwrap(), caller);
    }
}
