// import './styles/SettingsPageStyle.css';

interface Props {
  pageName?: string;
  visible?: boolean;
}

export default function SettingsPage({ /* pageName, */ visible }: Props) {
  return (
    <div className={`settings app-container-column ${visible ? '' : 'hide-page'}`}>
      <section className="app-section flex-1">
        <div className="title">
          <span className="left">LEFT BOX TITLE</span>
          <span className="right">Add some information on the right side here</span>
        </div>
        <div className="content box-time flex-column">
          <h1>SETTINGS PAGE</h1>
        </div>
      </section>
    </div>
  );
}
