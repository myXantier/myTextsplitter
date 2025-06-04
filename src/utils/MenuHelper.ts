// // Define a type for the keys of the menu
// type MenuKey = 'home' | 'about' | 'contact' | 'faq';

// interface PageConfigInterface {
//   title: string;
//   url: string;
//   isActive: boolean;
// }

export type keyValuePair<K, V> = {
    key: K;
    value: V;
}

export default class MenuHelper<K extends string, V> implements Iterable<[K, V]> {
  private readonly menu: Record<K, V>;

  constructor(menu: Record<K, V>) {
    this.menu = menu;
  }

  // Get the raw menu
  getMenu(): Record<K, V> {
    return this.menu;
  }

  // Get all keys in the menu
  getKeys(): K[] {
    return Object.keys(this.menu) as K[];
  }

  // Get all values in the menu
  getValues(): V[] {
    return Object.values(this.menu);
  }

  // Get all [keys, values] in the menu
  getEntries(): [K, V][] {
    return this.getKeys().map((key) => [key, this.menu[key]] as [K, V]);
  }

  // Map over the menu entries
  map<R>(callback: (key: K, value: V) => R): R[] {
    return this.getKeys().map((key) => callback(key, this.menu[key]));
  }

  forEach(callback: (key: K, value: V) => void): void {
    this.getKeys().forEach((key) => callback(key, this.menu[key]));
  }

  // Find a specific menu item by key
  findByKey(key?: K): V | undefined {
    return key ? this.menu[key] : undefined;
  }

  // Filter menu items based on a predicate
  filter(predicate: (key: K, value: V) => boolean): [K, V][] {
    return this.getEntries().filter(([key, value]) => predicate(key, value));
  }

  [Symbol.iterator](): Iterator<[K, V]> {
    let index = 0;
    const entries = this.getEntries();
    return {
      next(): IteratorResult<[K, V]> {
        if (index < entries.length) {
          return { value: entries[index++], done: false };
        } else {
          return { value: undefined, done: true } as IteratorResult<[K, V]>;
        }
      },
    };
  }
}

// // Example usage
// const menuPages: Record<MenuKey, PageConfigInterface> = {
//   home: { title: 'Startseite', url: '/', isActive: true },
//   about: { title: 'Über uns', url: '/about', isActive: false },
//   contact: { title: 'Kontakt', url: '/contact', isActive: false },
//   faq: { title: 'FAQ', url: '/faq', isActive: false },
// };

// // Create the helper instance
// const menuHelper = new MenuHelper(menuPages);

// // Nutzung von map:
// menuHelper.map((key, page) => {
//   console.log(`Key: ${key}, Title: ${page.title}`);
// });

// // Nutzung als Iterable:
// for (const [key, page] of menuHelper) {
//   console.log(`Iteriert: ${key} -> ${page.url}`);
// }

// // Example: Get all menu keys
// console.log(menuHelper.getKeys()); // Output: ['home', 'about', 'contact', 'faq']

// // Example: Get all menu values
// console.log(menuHelper.getValues());
// // Output: [
// //   { title: 'Home', url: '/home', isActive: true },
// //   { title: 'About Us', url: '/about', isActive: true },
// //   { title: 'Contact', url: '/contact', isActive: false },
// //   { title: 'FAQ', url: '/faq', isActive: true }
// // ]

// // Example: Map over the menu
// const menuTitles = menuHelper.map((key, value) => (value as PageConfigInterface).title);
// console.log(menuTitles); // Output: ['Home', 'About Us', 'Contact', 'FAQ']

// // Example: Find a specific menu item
// console.log(menuHelper.findByKey('about'));
// // Output: { title: 'About Us', url: '/about', isActive: true }

// // Example: Filter menu items where isActive is true
// const activePages = menuHelper.filter((key, value) => (value as PageConfigInterface).isActive);
// console.log(activePages);
// // Output: [
// //   ['home', { title: 'Home', url: '/home', isActive: true }],
// //   ['about', { title: 'About Us', url: '/about', isActive: true }],
// //   ['faq', { title: 'FAQ', url: '/faq', isActive: true }]
// // ]
