import { Dispatch, SetStateAction, useState } from 'react';
import { PageKey, pages } from '../config/pages';
import { useFileImport } from '../hooks/useFileImport';
import './styles/PageListStyle.css';

interface PageListProps {
  setPage?: PageKey;
  splitResults: string[][];
  setSplitResults: Dispatch<SetStateAction<string[][]>>;
}

export default function PageList({ setPage, splitResults, setSplitResults }: PageListProps) {
  const [sourceText, setSourceText] = useState('');
  // File import into the shared source text: kept here, so a running import and its lock survive a page change
  const sourceImport = useFileImport(setSourceText);

  const pageEntry = pages.findByKey(setPage);
  if (!pageEntry) return null;

  const PageComponent = pageEntry.component;

  return (
    <section className="pages">
      <div className="scrollable">
        <PageComponent
          sourceText={sourceText}
          setSourceText={setSourceText}
          sourceImport={sourceImport}
          splitResults={splitResults}
          setSplitResults={setSplitResults}
          visible={true}
        />
      </div>
    </section>
  );
}
