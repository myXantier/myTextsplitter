type Action = 'I' | 'A' | 'R';
type DiffRes = [Action, number, string];

function editDistance(s1: string[], s2: string[]): DiffRes[] {
  const m1 = s1.length;
  const m2 = s2.length;

  function calculateDistances(strip: number[]): number[] {
    const distances: number[] = [strip[0]];

    for (let i = 1; i < m2 + 1; i++) {
      distances[i] = Math.min(
        distances[i - 1] + 1,
        strip[i],
        strip[i - 1] + (s1[m1 - strip[i - 1]] === s2[i - 1] ? 0 : 1)
      );
    }
    return distances;
  }

  const patch: DiffRes[] = [];
  let strip1: number[] = new Array(m2 + 1).fill(0);
  let strip2: number[] = new Array(m2 + 1).fill(0);
  for (let i = 1; i < m1 + 1; i++) {
    strip2[0] = i;

    for (let j = 1; j < m2 + 1; j++) {
      strip2[j] = s1[i - 1] === s2[j - 1] ? strip1[j - 1] : Math.min(strip1[j - 1], strip1[j], strip2[j - 1]) + 1;
    }

    if (i < m1) {
      strip1 = calculateDistances(strip2);
    }
  }

  let n1 = m1;
  let n2 = m2;

  while (n1 > 0 || n2 > 0) {
    if (n1 === 0) {
      n2 -= 1;
      patch.push(['A', n2, s2[n2]]);
    } else if (n2 === 0) {
      n1 -= 1;
      patch.push(['R', n1, s1[n1]]);
    } else if (s1[n1 - 1] === s2[n2 - 1]) {
      n1 -= 1;
      n2 -= 1;
    } else if (strip2[n2] === strip1[n1 - 1] + 1) {
      n1 -= 1;
      patch.push(['R', n1, s1[n1]]);
    } else {
      n2 -= 1;
      patch.push(['A', n2, s2[n2]]);
    }
  }
  patch.sort((a, b) => a[1] - b[1]);

  patch.reverse();

  return patch;
}

const PATCH_LINE_REGEXP: RegExp = /([AR]) (\d+) (.*)/;

class Subcommand {
  name: string;
  signature: string;
  description: string;

  constructor(name: string, signature: string, description: string) {
    this.name = name;
    this.signature = signature;
    this.description = description;
  }

  run(text1: string, text2: string): string | DiffRes[] {
    throw new Error('Method not implemented.');
  }
}

export class DiffSubcommand extends Subcommand {
  constructor() {
    super('diff', '<text1> <text2>', 'print the difference between the texts');
  }

  run(text1: string, text2: string): string | DiffRes[] {
    try {
      const lines1 = text1.split('\n');
      const lines2 = text2.split('\n');

      const patch = editDistance(lines1, lines2);
      return patch ?? '';
    } catch (error) {
      console.error(`Error during execution: ${error}`);
      return '';
    }
  }
}

export class PatchSubcommand extends Subcommand {
  constructor() {
    super('patch', '<text> <text.patch>', 'patch the text with the given patch');
  }

  run(text1: string, text2: string): string | DiffRes[] {
    console.log(`Executing ${this.name} subcommand...`);
    
    const lines = text1.split('\n');
    const patch: [Action, number, string][] = [];
    let ok = true;

    for (const [row, line] of text2.split('\n').entries()) {
      if (line.length === 0) {
        continue;
      }
      const m = line.match(PATCH_LINE_REGEXP);
      if (m === null) {
        console.log(`${row + 1}: Invalid patch action: ${line}`);
        ok = false;
        continue;
      }
      patch.push([m[1] as Action, parseInt(m[2]), m[3]]);
    }
    if (!ok) {
      return '';
    }

    for (const [action, row, line] of patch.reverse()) {
      if (action === 'A') {
        lines.splice(row, 0, line);
      } else if (action === 'R') {
        lines.splice(row, 1);
      } else {
        throw new Error('unreachable');
      }
    }

    return lines.join('\n');
  }
}


const text1 = "Test 1\nTest 2\nTest 3\nTest 4";
const text2 = "Test 1\nTest 2\nTest 4\nTest 5";


const diffClass = new DiffSubcommand();
const res = diffClass.run(text1, text2);
console.log(res);
