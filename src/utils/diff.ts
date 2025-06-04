export interface WordDiff {
  text: string; 
  type: 'added' | 'removed' | 'unchanged' | 'changed' | 'moved';
}

export const computeLinearDiff = (oldText: string, newText: string): DiffResult[] => {
  return computeLinearDiffFromArray(oldText?.split('\n') ?? [], newText?.split('\n') ?? []);
};
  
export const computeLinearDiffFromArray = (oldLines: string[], newLines: string[]): DiffResult[] => {
  const result: DiffResult[] = [];
  if ((oldLines?.length ?? 0) === 0 && (newLines?.length ?? 0) === 0) return result;

  // First, identify unchanged lines
  const oldLineSet = new Set(oldLines);
  const newLineSet = new Set(newLines);
  const commonLines = new Set([...oldLineSet].filter(line => newLineSet.has(line)));

  // Identify added lines (in new but not in old)
  // NEW
  for (let i = 0; i < newLines.length; i++) {
    const line = newLines[i];
    const oldIndex = oldLines.indexOf(line);
  
    // 1) Wenn vorhanden, aber an anderer Position → moved
    if (commonLines.has(line) && oldIndex !== -1 && oldIndex !== i) {
      result.push({ type: 'moved', text: line, lineNumber: i + 1 });
  
    // 2) Wenn neu hinzugekommen oder öfter vorkommend → added
    } else if (
      !commonLines.has(line)
      || countOccurrences(newLines, line) > countOccurrences(oldLines, line)
    ) {
      result.push({ type: 'added', text: line, lineNumber: i + 1 });
  
    // 3) sonst unverändert
    } else {
      result.push({ type: 'unchanged', text: line, lineNumber: i + 1 });
    }
  }
  // OLD
  // for (let i = 0; i < newLines.length; i++) {
  //   const line = newLines[i];
  //   if (!commonLines.has(line) || countOccurrences(newLines, line) > countOccurrences(oldLines, line)) {
  //     result.push({ type: 'added', text: line, lineNumber: i + 1 });
  //   } else if (commonLines.has(line)) {
  //     result.push({ type: 'unchanged', text: line, lineNumber: i + 1 });
  //   }
  // }


  // Identify removed lines (in old but not in new)
  for (let i = 0; i < oldLines.length; i++) {
    const line = oldLines[i];
    if (!commonLines.has(line) || countOccurrences(oldLines, line) > countOccurrences(newLines, line)) {
      result.push({ type: 'removed', text: line, lineNumber: i + 1 });
    }
  }

  // Sort by line number
  result.sort((a, b) => a.lineNumber - b.lineNumber);

  // Detect moved lines
  detectMovedLines(result);

  return result;
};

// Calculate similarity between two strings
export const calculateSimilarity = (str1: string, str2: string): number => {
  if (!str1 && !str2) return 1;
  if (!str1 || !str2) return 0;
  
  const len1 = str1.length;
  const len2 = str2.length;
  
  // Simple character-based similarity check
  const commonLength = Math.min(len1, len2);
  let commonChars = 0;
  
  for (let i = 0; i < commonLength; i++) {
    if (str1[i] === str2[i]) commonChars++;
  }
  
  return commonChars / Math.max(len1, len2);
};

// Count occurrences of a string in an array
function countOccurrences(arr: string[], value: string): number {
  return arr.filter(item => item === value).length;
}

// Detect moved lines in the diff results
function detectMovedLines(results: DiffResult[]): void {
  const addedLines = results.filter(r => r.type === 'added');
  const removedLines = results.filter(r => r.type === 'removed');
  
  const processedAdded = new Set<number>();
  
  for (const removed of removedLines) {
    const similarAdded = addedLines.find((added, index) => 
      !processedAdded.has(index) && 
    removed.text === added.text //calculateSimilarity(removed.text, added.text) > 0.8
    );
    
    if (similarAdded) {
      const index = results.indexOf(similarAdded);
      if (index !== -1) {
        results[index].type = 'moved';
        processedAdded.add(addedLines.indexOf(similarAdded));
      }
    }
  }
}

// Compare two lines word by word and return an array of word differences
export const getWordDiffs = (oldLine: string, newLine: string): WordDiff[] => {
  if (!oldLine || !newLine) {
    return oldLine 
      ? [{ text: oldLine, type: 'removed' }] 
      : newLine 
        ? [{ text: newLine, type: 'added' }]
        : [];
  }
  
  // Split lines into words, preserving spaces and punctuation
  const oldWords = oldLine.match(/\S+|\s+/g) || [];
  const newWords = newLine.match(/\S+|\s+/g) || [];
  
  const result: WordDiff[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  // Simple algorithm to identify added, removed and unchanged words
  while (oldIndex < oldWords.length || newIndex < newWords.length) {
    // Both lines have words left
    if (oldIndex < oldWords.length && newIndex < newWords.length) {
      if (oldWords[oldIndex] === newWords[newIndex]) {
        // Words match - unchanged
        result.push({ text: oldWords[oldIndex], type: 'unchanged' });
        oldIndex++;
        newIndex++;
      } else {
        // Try to look ahead to see if words are added/removed or just changed
        const oldAhead = oldWords.slice(oldIndex + 1, oldIndex + 4);
        const newAhead = newWords.slice(newIndex + 1, newIndex + 4);
        
        // Check for moved words
        const isOldInNew = newAhead.includes(oldWords[oldIndex]);
        const isNewInOld = oldAhead.includes(newWords[newIndex]);
        
        if (isOldInNew && isNewInOld) {
          // Words appear in both, but in different order - moved
          result.push({ text: oldWords[oldIndex], type: 'moved' });
          oldIndex++;
        } else if (isOldInNew) {
          // Added word in new text
          result.push({ text: newWords[newIndex], type: 'added' });
          newIndex++;
        } else if (isNewInOld) {
          // Removed word from old text
          result.push({ text: oldWords[oldIndex], type: 'removed' });
          oldIndex++;
        } else {
          // Words are different - changed
          const oldWord = oldWords[oldIndex];
          const newWord = newWords[newIndex];
          
          // Check if words are similar enough to be considered a change rather than add/remove
          const similarity = calculateSimilarity(oldWord, newWord);
          if (similarity > 0.6) {
            result.push({ text: newWord, type: 'changed' });
          } else {
            result.push({ text: oldWord, type: 'removed' });
            result.push({ text: newWord, type: 'added' });
          }
          oldIndex++;
          newIndex++;
        }
      }
    } else if (oldIndex < oldWords.length) {
      // Only old line has words left
      result.push({ text: oldWords[oldIndex], type: 'removed' });
      oldIndex++;
    } else if (newIndex < newWords.length) {
      // Only new line has words left
      result.push({ text: newWords[newIndex], type: 'added' });
      newIndex++;
    }
  }

  return result;
};

// Group the diff results for split view
export const groupDiffResults = (diffResults: DiffResult[]) => {
  if (!diffResults.length) return { removed: [], added: [], unchanged: [] };
  
  return diffResults.reduce((acc, result) => {
    if (result.type === 'removed') {
      acc.removed.push(result);
    } else if (result.type === 'added') {
      acc.added.push(result);
    } else {
      acc.unchanged.push(result);
    }
    return acc;
  }, { removed: [] as DiffResult[], added: [] as DiffResult[], unchanged: [] as DiffResult[] });
};

// Pair diff results for more accurate side-by-side comparison
export const pairDiffResults = (diffResults: DiffResult[]) => {
  if (!diffResults.length) return [];
  
  const pairs: Array<{ left: DiffResult | null, right: DiffResult | null }> = [];
  const { removed, added, unchanged } = groupDiffResults(diffResults);
  
  // First add all unchanged lines
  unchanged.forEach(line => {
    pairs.push({ left: line, right: line });
  });
  
  // Then process removed and added lines, attempting to pair them
  const processedRemoved = new Set<number>();
  const processedAdded = new Set<number>();
  
  // Match by line number first
  removed.forEach((removedLine, index) => {
    const matchingAdded = added.find(
      addedLine => !processedAdded.has(added.indexOf(addedLine)) && 
      calculateSimilarity(removedLine.text, addedLine.text) > 0.5
    );
    
    if (matchingAdded) {
      pairs.push({ left: removedLine, right: matchingAdded });
      processedRemoved.add(index);
      processedAdded.add(added.indexOf(matchingAdded));
    }
  });
  
  // Add remaining unmatched lines
  removed.forEach((removedLine, index) => {
    if (!processedRemoved.has(index)) {
      pairs.push({ left: removedLine, right: null });
    }
  });
  
  added.forEach((addedLine, index) => {
    if (!processedAdded.has(index)) {
      pairs.push({ left: null, right: addedLine });
    }
  });
  
  // Sort by line number
  return pairs.sort((a, b) => {
    const aLine = a.left?.lineNumber || a.right?.lineNumber || 0;
    const bLine = b.left?.lineNumber || b.right?.lineNumber || 0;
    return aLine - bLine;
  });
};