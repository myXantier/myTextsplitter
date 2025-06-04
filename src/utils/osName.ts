export type OSName = 'unknown' | 'Windows' | 'Linux' | 'MacOS';

export function getOsName(): OSName {
  // const currentOs = (/((?:Win|Linux|Mac|CrOS)\S*(?: x[368][246]\w*))/i.exec(window.navigator.userAgent || navigator.userAgent)?.pop() || 'unknown');
  return (/((?:Win|Linux|Mac)\S*)/i.exec(window.navigator.userAgent || navigator.userAgent)?.pop() ||
    'unknown') as OSName;
}

interface DataItem {
  name: string;
  value: string;
  version: string;
}

interface SystemInfo {
  name: string;
  version: number;
}

interface OSDataResult {
  os: SystemInfo;
  browser: SystemInfo;
}

export function getOSData(): OSDataResult {
  const header: string[] = [
    window.navigator.platform,
    window.navigator.userAgent,
    window.navigator.appVersion,
    window.navigator.vendor,
    // window.opera ist nicht standardmäßig typisiert, daher als any:
    /* (window as any).opera || */ '',
  ];

  const dataos: DataItem[] = [
    { name: 'Windows Phone', value: 'Windows Phone', version: 'OS' },
    { name: 'Windows', value: 'Win', version: 'NT' },
    { name: 'iPhone', value: 'iPhone', version: 'OS' },
    { name: 'iPad', value: 'iPad', version: 'OS' },
    { name: 'Kindle', value: 'Silk', version: 'Silk' },
    { name: 'Android', value: 'Android', version: 'Android' },
    { name: 'PlayBook', value: 'PlayBook', version: 'OS' },
    { name: 'BlackBerry', value: 'BlackBerry', version: '/' },
    { name: 'Macintosh', value: 'Mac', version: 'OS X' },
    { name: 'Linux', value: 'Linux', version: 'rv' },
    { name: 'Palm', value: 'Palm', version: 'PalmOS' },
  ];

  const databrowser: DataItem[] = [
    { name: 'Chrome', value: 'Chrome', version: 'Chrome' },
    { name: 'Firefox', value: 'Firefox', version: 'Firefox' },
    { name: 'Safari', value: 'Safari', version: 'Version' },
    { name: 'Internet Explorer', value: 'MSIE', version: 'MSIE' },
    { name: 'Opera', value: 'Opera', version: 'Opera' },
    { name: 'BlackBerry', value: 'CLDC', version: 'CLDC' },
    { name: 'Mozilla', value: 'Mozilla', version: 'Mozilla' },
  ];

  function matchItem(input: string, data: DataItem[]): SystemInfo {
    for (let i = 0; i < data.length; i++) {
      const regex = new RegExp(data[i].value, 'i');
      if (regex.test(input)) {
        const regexVersion = new RegExp(data[i].version + '[- /:;]([\\d._]+)', 'i');
        let matches = input.match(regexVersion);
        let versionStr = '';
        if (matches && matches[1]) {
          // matches[1] enthält den Versionsstring, z. B. "10_0_1"
          const versionParts = matches[1].split(/[._]+/);
          // Baue eine Version im Format "10.0.1" zusammen:
          versionStr = versionParts.join('.');
        } else {
          versionStr = '0';
        }
        return {
          name: data[i].name,
          version: parseFloat(versionStr),
        };
      }
    }
    return { name: 'unknown', version: 0 };
  }


  const agent = header.join(' ');
  const os = matchItem(agent, dataos);
  const browser = matchItem(agent, databrowser);

  return { os, browser };
}
