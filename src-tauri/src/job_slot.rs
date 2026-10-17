//! Bounded "latest job wins" execution of the CPU-heavy text commands (Split, Filter, Remove, Diff).
//!
//! Per operation there is one [`JobSlot`] with **at most one running and at most one waiting job**:
//! - The running job executes on Tokio's blocking pool. It has its own [`JobControl`] (Paket 10 E6): a newer job of
//!   the same slot marks it as superseded, and a regex job ends at its next check with `TextError::Superseded`
//!   (or with `TextError::RegexRuntime` when its [`RegexBudget`] is used up). The checks are cooperative: a single
//!   running regex search cannot be interrupted, the job ends at the first check after it. A job without checks
//!   (plain split, plain Remove, duplicates, Diff) runs to its end; its result is still delivered and the frontend
//!   discards it if it is outdated.
//! - A new job replaces the waiting one. The replaced job never runs: its input is dropped at once and its
//!   caller receives `TextError::Superseded`.
//! - Waiting happens in the async command future (a channel receive), not in a blocking thread. One blocking
//!   thread per operation runs the jobs one after the other and ends when no job is waiting.
//!
//! So per operation there are at most two input copies (running + waiting) and at most one blocking thread,
//! however many requests arrive. Different operations have their own slot and do not block each other.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tauri::async_runtime::{channel, Sender};

use crate::text_processor::{Checkpoint, TextError};

type Job<T> = Box<dyn FnOnce(&JobControl) -> Result<T, TextError> + Send>;

/// Control of one running job: created when the job starts to execute (not when it is queued), so a budget starts
/// there. Only the job it belongs to observes it; a newer job of the same slot marks it as superseded.
pub struct JobControl {
    started: Instant,
    superseded: AtomicBool,
}

impl JobControl {
    fn new() -> Self {
        JobControl { started: Instant::now(), superseded: AtomicBool::new(false) }
    }

    /// When the job started to execute.
    #[cfg(test)]
    pub fn started(&self) -> Instant {
        self.started
    }

    /// True once a newer job of the same slot was submitted while this one was running.
    pub fn is_superseded(&self) -> bool {
        self.superseded.load(Ordering::Acquire)
    }

    fn supersede(&self) {
        self.superseded.store(true, Ordering::Release);
    }

    /// The checkpoint of a user regex job: `budget` from the start of the job, and the supersede signal.
    pub fn regex_budget(&self, budget: Duration) -> RegexBudget<'_> {
        RegexBudget { control: self, deadline: self.started + budget, budget }
    }
}

/// Cooperative time budget and supersede signal of a user regex job (Paket 10 E6). It does not interrupt a running
/// search: the job ends at the first check after the deadline or after a newer job arrived.
pub struct RegexBudget<'a> {
    control: &'a JobControl,
    deadline: Instant,
    budget: Duration,
}

impl Checkpoint for RegexBudget<'_> {
    fn check(&self) -> Result<(), TextError> {
        if self.control.is_superseded() {
            return Err(TextError::Superseded);
        }
        if Instant::now() >= self.deadline {
            // Same kind as the backtrack limit: the frontend shows errors.regexTooComplex
            return Err(TextError::RegexRuntime(format!("time budget of {} ms for the regex job exceeded", self.budget.as_millis())));
        }
        Ok(())
    }
}

struct Waiting<T> {
    job: Job<T>,
    reply: Sender<Result<T, TextError>>,
}

struct SlotState<T> {
    /// A blocking thread is running jobs of this slot.
    running: bool,
    waiting: Option<Waiting<T>>,
    /// Control of the job that is executing right now (set and cleared by the runner under this lock).
    current: Option<Arc<JobControl>>,
}

pub struct JobSlot<T> {
    state: Mutex<SlotState<T>>,
}

impl<T: Send + 'static> JobSlot<T> {
    pub const fn new() -> Self {
        JobSlot { state: Mutex::new(SlotState { running: false, waiting: None, current: None }) }
    }

    /// The state is only held for short updates (no job runs under the lock); a poisoned lock is used further.
    fn state(&self) -> MutexGuard<'_, SlotState<T>> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Runs `job` as the latest job of this slot. Resolves with its result, or with `TextError::Superseded` if a newer
    /// job replaced it before it started (or, for a job that checks its `JobControl`, while it ran).
    pub async fn run<F>(&'static self, job: F) -> Result<T, TextError>
    where
        F: FnOnce(&JobControl) -> Result<T, TextError> + Send + 'static,
    {
        let (reply, mut result) = channel(1);
        let start_runner = {
            let mut state = self.state();
            if let Some(replaced) = state.waiting.replace(Waiting { job: Box::new(job), reply }) {
                // Not started yet: it never runs, its input is dropped here
                let _ = replaced.reply.try_send(Err(TextError::Superseded));
            }
            // The job executing now was submitted before this one (the runner registers it under this lock when it takes
            // it): a job never signals itself or a newer job
            if let Some(current) = &state.current {
                current.supersede();
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
            // Taking the waiting job and registering its control is one step under the lock: a job submitted after it
            // can only signal this one; a job submitted before it was replaced or ran earlier
            let (Waiting { job, reply }, control) = {
                let mut state = self.state();
                match state.waiting.take() {
                    Some(waiting) => {
                        let control = Arc::new(JobControl::new());
                        state.current = Some(control.clone());
                        (waiting, control)
                    }
                    None => {
                        state.current = None;
                        state.running = false;
                        return;
                    }
                }
            };
            let result = catch_unwind(AssertUnwindSafe(|| job(&control)))
                .unwrap_or_else(|_| Err(TextError::Internal("text processing job panicked".into())));
            // The control ends with its job (also after a panic): a job submitted from now on signals nothing old
            self.state().current = None;
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
    fn blocking_job(started: mpsc::Sender<()>, release: mpsc::Receiver<()>, value: u32) -> impl FnOnce(&JobControl) -> Result<u32, TextError> + Send + 'static {
        move |_| {
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
                submit(SLOT.run(move |_| {
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
        let outdated = submit(SLOT.run(move |_| Ok(held.len() as u32)));
        assert_eq!(std::sync::Arc::strong_count(&input), 2, "the waiting job holds its input");
        let latest = submit(SLOT.run(|_| Ok(7)));
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
                spawn(SLOT.run(move |_| {
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
        let second = submit(SLOT.run(|_| Ok(2)));
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
        assert_eq!(block_on(SLOT_B.run(|_| Ok(2))), Ok(2), "B runs while A is still running");
        release_tx.send(()).unwrap();
        assert_eq!(block_on(a).unwrap(), Ok(1));
    }

    #[test]
    fn failing_and_panicking_jobs_do_not_block_later_jobs() {
        static SLOT: JobSlot<u32> = JobSlot::new();
        assert_eq!(block_on(SLOT.run(|_| Err(TextError::RegexRuntime("limit".into())))), Err(TextError::RegexRuntime("limit".into())));
        let panicked = block_on(SLOT.run(|_| panic!("job panicked")));
        assert!(matches!(panicked, Err(TextError::Internal(_))), "{panicked:?}");
        assert_eq!(block_on(SLOT.run(|_| Ok(3))), Ok(3));
        wait_until_idle(&SLOT);
    }

    // --- Paket 10 E6: supersede signal and budget of the running job ---

    /// A running regex job: signals its start, waits for `release` (a search step in progress, no check meanwhile), then
    /// checks its budget until a check fails (the supersede signal of a newer job, or the budget). `WAIT` bounds it.
    fn checking_job(started: mpsc::Sender<()>, release: mpsc::Receiver<()>) -> impl FnOnce(&JobControl) -> Result<u32, TextError> + Send + 'static {
        move |control| {
            let budget = control.regex_budget(WAIT);
            started.send(()).unwrap();
            release.recv_timeout(WAIT).map_err(|_| TextError::Internal("not released".into()))?;
            loop {
                budget.check()?;
                std::thread::yield_now();
            }
        }
    }

    #[test]
    fn a_running_job_is_superseded_by_a_newer_one_and_the_newer_one_runs() {
        static SLOT: JobSlot<u32> = JobSlot::new();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let running = submit(SLOT.run(checking_job(started_tx, release_rx)));
        started_rx.recv_timeout(WAIT).expect("running job started");
        release_tx.send(()).unwrap();

        // The newer job is not signalled itself: it sees a fresh control
        let newer = submit(SLOT.run(|control| Ok(control.is_superseded() as u32 + 10)));
        assert_eq!(block_on(running).unwrap(), Err(TextError::Superseded), "the running job ends at its next check");
        assert_eq!(block_on(newer).unwrap(), Ok(10), "the newer job runs right after it, not superseded");
        wait_until_idle(&SLOT);
    }

    #[test]
    fn many_quick_requests_while_a_job_runs_only_the_latest_runs() {
        static SLOT: JobSlot<u32> = JobSlot::new();
        static EXECUTED: AtomicUsize = AtomicUsize::new(0);
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let running = submit(SLOT.run(checking_job(started_tx, release_rx)));
        started_rx.recv_timeout(WAIT).unwrap();
        // All requests arrive while the running job does not check yet (a search step in progress)
        let requests: Vec<_> = (1..=10u32)
            .map(|i| {
                submit(SLOT.run(move |control| {
                    EXECUTED.fetch_add(1, Ordering::SeqCst);
                    // Requests submitted later would signal this one; none comes, so it finishes
                    Ok(i + 100 * control.is_superseded() as u32)
                }))
            })
            .collect();
        release_tx.send(()).unwrap();
        assert_eq!(block_on(running).unwrap(), Err(TextError::Superseded));
        let results: Vec<_> = requests.into_iter().map(|r| block_on(r).unwrap()).collect();
        assert!(results[..9].iter().all(|r| r == &Err(TextError::Superseded)), "{results:?}");
        assert_eq!(results[9], Ok(10), "only the latest request runs, with its own fresh control");
        assert_eq!(EXECUTED.load(Ordering::SeqCst), 1);
        wait_until_idle(&SLOT);
    }

    #[test]
    fn the_budget_starts_when_the_job_executes_not_when_it_is_queued() {
        static SLOT: JobSlot<Instant> = JobSlot::new();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let first = submit(SLOT.run(move |_| {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(WAIT).map_err(|_| TextError::Internal("not released".into()))?;
            Ok(Instant::now())
        }));
        started_rx.recv_timeout(WAIT).unwrap();
        let queued_at = Instant::now();
        // A job without checks (e.g. a plain split) is not superseded by a later request: it runs to its end
        let second = submit(SLOT.run(|control| {
            assert!(!control.is_superseded());
            Ok(control.started())
        }));
        release_tx.send(()).unwrap();
        let first_ended = block_on(first).unwrap().unwrap();
        let second_started = block_on(second).unwrap().unwrap();
        assert!(second_started >= first_ended && second_started > queued_at, "the control of the second job is created when it starts");
        wait_until_idle(&SLOT);
    }

    #[test]
    fn a_panicking_job_releases_its_control_and_the_next_job_is_not_superseded() {
        static SLOT: JobSlot<u32> = JobSlot::new();
        let panicked = block_on(SLOT.run(|_| panic!("job panicked")));
        assert!(matches!(panicked, Err(TextError::Internal(_))), "{panicked:?}");
        assert!(SLOT.state().current.is_none(), "no control is left registered");
        assert_eq!(block_on(SLOT.run(|control| Ok(control.is_superseded() as u32))), Ok(0));
        wait_until_idle(&SLOT);
        assert!(SLOT.state().current.is_none());
    }

    #[test]
    fn a_request_of_another_operation_does_not_supersede_a_running_job() {
        static SLOT_A: JobSlot<u32> = JobSlot::new();
        static SLOT_B: JobSlot<u32> = JobSlot::new();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let a = submit(SLOT_A.run(move |control| {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(WAIT).map_err(|_| TextError::Internal("not released".into()))?;
            control.regex_budget(WAIT).check()?;
            Ok(1)
        }));
        started_rx.recv_timeout(WAIT).unwrap();
        assert_eq!(block_on(SLOT_B.run(|_| Ok(2))), Ok(2), "B runs while A is still running");
        release_tx.send(()).unwrap();
        assert_eq!(block_on(a).unwrap(), Ok(1), "A is not superseded by B");
        wait_until_idle(&SLOT_A);
    }

    #[test]
    fn an_exceeded_budget_ends_a_real_regex_job_without_a_result() {
        // Small real budget on the Paket 10 Phase A pattern: several seconds without the budget (debug build even more)
        static SLOT: JobSlot<crate::text_processor::ProcessedText<String>> = JobSlot::new();
        let text = vec!["a".repeat(18); 1000].join("\n");
        let start = Instant::now();
        let result = block_on(SLOT.run(move |control| {
            crate::text_processor::TextProcessor::filter_text_checked(&text, "(a|aa)+(?=c)", "keep", true, false, &control.regex_budget(Duration::from_millis(50)))
        }));
        assert!(matches!(&result, Err(TextError::RegexRuntime(message)) if message.contains("time budget of 50 ms")), "{:?}", result.map(|r| r.result_text.len()));
        assert!(start.elapsed() < Duration::from_secs(3), "ended near the budget: {:?}", start.elapsed());
        // The next valid job of the slot works
        let valid = block_on(SLOT.run(|control| crate::text_processor::TextProcessor::filter_text_checked("ab\ncb", "b", "keep", true, false, &control.regex_budget(Duration::from_secs(10)))));
        assert_eq!(valid.unwrap().result_text, "b\nb");
        wait_until_idle(&SLOT);
    }

    #[test]
    fn a_newer_request_supersedes_a_running_real_regex_job_at_its_next_search_step() {
        // Several seconds without supersede; it ends at the next check after the newer request arrived
        static SLOT: JobSlot<crate::text_processor::ProcessedText<String>> = JobSlot::new();
        let text = vec!["a".repeat(18); 1000].join("\n");
        let (started_tx, started_rx) = mpsc::channel();
        let running = submit(SLOT.run(move |control| {
            started_tx.send(()).unwrap();
            crate::text_processor::TextProcessor::filter_text_checked(&text, "(a|aa)+(?=c)", "keep", true, false, &control.regex_budget(Duration::from_secs(60)))
        }));
        started_rx.recv_timeout(WAIT).unwrap();
        let start = Instant::now();
        let newer = submit(SLOT.run(|control| crate::text_processor::TextProcessor::filter_text_checked("ab", "b", "keep", true, false, &control.regex_budget(Duration::from_secs(10)))));
        assert_eq!(block_on(running).unwrap().map(|r| r.result_text), Err(TextError::Superseded));
        assert_eq!(block_on(newer).unwrap().map(|r| r.result_text), Ok("b".to_string()), "the newer job delivers its result");
        assert!(start.elapsed() < Duration::from_secs(3), "{:?}", start.elapsed());
        wait_until_idle(&SLOT);
    }

    #[test]
    fn jobs_run_on_a_blocking_thread() {
        static SLOT: JobSlot<std::thread::ThreadId> = JobSlot::new();
        let caller = std::thread::current().id();
        assert_ne!(block_on(SLOT.run(|_| Ok(std::thread::current().id()))).unwrap(), caller);
    }
}
