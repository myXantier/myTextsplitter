import { Dispatch, SetStateAction, useState } from 'react';
import { PageKey, pages } from '../config/pages';
import './styles/PageListStyle.css';

interface PageListProps {
  setPage?: PageKey;
  splitResults: string[][];
  setSplitResults: Dispatch<SetStateAction<string[][]>>;
}

export default function PageList({ setPage, splitResults, setSplitResults }: PageListProps) {
  const [sourceText, setSourceText] = useState('');

  const pageEntry = pages.findByKey(setPage);
  if (!pageEntry) return null;

  const PageComponent = pageEntry.component;

  return (
    <section className="pages">
      <div className="scrollable">
        <PageComponent
          sourceText={sourceText}
          setSourceText={setSourceText}
          splitResults={splitResults}
          setSplitResults={setSplitResults}
          visible={true}
        />
      </div>
    </section>
  );
}
