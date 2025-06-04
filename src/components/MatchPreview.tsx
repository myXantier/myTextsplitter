import { useEffect, useState } from 'react';
import './styles/MatchPreviewStyle.css';

interface MatchPreviewProps {
  sourceText: string;
  pattern: string;
  caseSensitive: boolean;
}

export function MatchPreview({ sourceText, pattern, caseSensitive }: MatchPreviewProps) {
  const [matches, setMatches] = useState<string[][]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!pattern || !sourceText) {
      setMatches([]);
      return;
    }

    try {
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(pattern, flags);
      const lines = sourceText.split('\n');
      const foundMatches: string[][] = [];

      for (const line of lines) {
        const parts: string[] = [];
        let lastIndex = 0;

        for (const match of line.matchAll(regex)) {
          if (match.index === undefined) continue;

          // Add text before match
          if (match.index > lastIndex) {
            parts.push(line.slice(lastIndex, match.index));
          }

          // Add matched text with special marker
          parts.push(`★${match[0]}★`);

          lastIndex = match.index + match[0].length;
        }

        // Add remaining text after last match
        if (lastIndex < line.length) {
          parts.push(line.slice(lastIndex));
        }

        if (parts.length > 1) {
          foundMatches.push(parts);
        }
      }

      setMatches(foundMatches);
      setCurrentIndex(0);
    } catch (error) {
      setMatches([]);
    }
  }, [sourceText, pattern, caseSensitive]);

  if (matches.length === 0) return null;

  return (
    <div className="match-preview">
      <div className="preview-content">
        {matches[currentIndex].map((part, idx) => {
          const isMatch = part.startsWith('★') && part.endsWith('★');
          return (
            <span 
              key={idx} 
              className={isMatch ? 'match-highlight' : 'match-text'}
            >
              {isMatch ? part.slice(1, -1) : part}
            </span>
          );
        })}
      </div>
      <div className="preview-controls">
        <span className="match-count">
          {currentIndex + 1} / {matches.length} {matches.length === 1 ? 'match' : 'matches'}
        </span>
        <button
          onClick={() => setCurrentIndex((prev) => (prev > 0 ? prev - 1 : matches.length - 1))}
          disabled={matches.length === 0 || currentIndex === 0}
        >
          ⬅
        </button>
        <button
          onClick={() => setCurrentIndex((prev) => (prev < matches.length - 1 ? prev + 1 : 0))}
          disabled={matches.length === 0 || currentIndex === matches.length - 1}
        >
          ➡
        </button>
      </div>
    </div>
  );
}