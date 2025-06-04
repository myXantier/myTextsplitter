import { MyAppLogo } from '../components/SvgIcons';
import { DebugConsole } from '../other/DebugConsole';
import { useSettings } from '../hooks/useSettings';
import useSnackbar from '../hooks/useSnackbar';
import './styles/AboutPageStyle.css';

interface Props {
  pageName?: string;
  visible?: boolean;
}

export default function AboutPage({ visible }: Props) {
  const ui = useSettings((state) => state.ui);
  const theme = useSettings((state) => state.theme);
  const snackbar = useSnackbar();

  return (
    <div className={`about app-container-column ${visible ? '' : 'hide-page'}`}>
      <section className="app-section flex-1">
        <div className="title">
          <span className="left">ABOUT BRC</span>
          <span className="right">information page</span>
        </div>
        <div className="content box-time flex-column">
          <div className="row app-image">
            <MyAppLogo color={theme.colors.color} height="120" />
          </div>
          <div className="row app-info-box">
            <div className="left">name:</div>
            <div className="right">
              <b>{ui.appName}</b>
            </div>
          </div>
          <div className="row app-info-box">
            <div className="left">version:</div>
            <div className="right">{ui.appVersion}</div>
          </div>
          <div className="row app-info-box">
            <div className="left">development credits:</div>
            <div className="right">{'by: Xantier'}</div>
          </div>
          <div className="row app-info-box">
            <div className="left">email:</div>
            <div className="right user_selection">{'myXantier@xantier.com'}</div>
          </div>
          <div className="row app-info-box">
            <div className="left">framework:</div>
            <div className="right">Tauri v2.2 with React</div>
          </div>
          <div className="row app-info-box">
            <div className="left">languages:</div>
            <div className="right">TypeScript (frontend) and Rust (backend)</div>
          </div>
        </div>
      </section>

      <section className="app-section m-2">
        <div className='p-5'>
          <button onClick={() => snackbar.success('This is an success message', 3000, 'top-right')}>Show Success</button>
          <button onClick={() => snackbar.info('This is an info message', 2000)}>Show Info</button>
          <button onClick={() => snackbar.warning('This is a warning message', 4000, 'top-left')}>Show Warning</button>
          <button onClick={() => snackbar.error('This is an error message', 5000, 'top-center')}>Show Error</button>
        </div>
      </section>

      
    </div>
  );
}
