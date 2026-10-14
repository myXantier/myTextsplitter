// Word highlighting of the current DiffPage (unchanged code from the former `src/utils/diff.ts`). Its known issues
// (3-token lookahead, "changed" shows only the new word, partner choice in DiffPage) are replaced in Paket 7 B2/B3;
// see docs/analyse/Paket7-PhaseA-Diff-Analyse.md, section 7. The line diff itself is `lineDiff.ts`.

export interface WordDiff {
  text: string; 
  type: 'added' | 'removed' | 'unchanged' | 'changed' | 'moved';
}

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