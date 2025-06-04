import MenuHelper from '../utils/MenuHelper';

import SplitPage from '../pages/SplitPage';
import FilterPage from '../pages/FilterPage';
import RemovePage from '../pages/RemovePage';
import DiffPage from '../pages/DiffPage';
import SortPage from '../pages/SortPage';
import AboutPage from '../pages/AboutPage';
import SettingsPage from '../pages/SettingsPage';

import {
  SplitSquareHorizontal,
  Filter,
  Trash2,
  GitCompare,
  ArrowDownUp,
  Settings,
  Info
} from 'lucide-react';

export type PageKey = 'split' | 'sort' | 'filter' | 'remove' | 'diff' | 'settings' | 'about';

export interface PageConfig {
  // key: PageKey;
  title: string;

  icon?: JSX.Element;
  component: (props: any) => JSX.Element;
  showInMenu?: boolean;
  bottomMenu?: boolean;
}

const pagesInternal: Record<PageKey, PageConfig> = {
  split: {
    title: 'Split Text',
    icon: <SplitSquareHorizontal size="24" />,
    component: SplitPage,
    showInMenu: true,
  },

  sort: {
    title: 'Sort Text',
    icon: <ArrowDownUp size="24" />,
    component: SortPage,
    showInMenu: true,
  },

  filter: {
    title: 'Filter Text', 
    icon: <Filter size="24" />,
    component: FilterPage,
    showInMenu: true,
  },

  remove: {
    title: 'Remove Lines',
    icon: <Trash2 size="24" />,
    component: RemovePage,
    showInMenu: true,
  },

  diff: {
    title: 'Diff Text',
    icon: <GitCompare size="24" />,
    component: DiffPage,
    showInMenu: true,
  },

  settings: {
    title: 'Settings',
    icon: <Settings size="24" />,
    component: SettingsPage,
    showInMenu: false,
  },

  about: {
    title: 'About',
    icon: <Info size="24" />,
    component: AboutPage,
    bottomMenu: true,
  },
};

export const pages = new MenuHelper(pagesInternal);