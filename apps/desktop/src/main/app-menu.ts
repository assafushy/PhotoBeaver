import { Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * The application menu with "Lock" and "Switch user" (SPEC 3.3), next to the
 * standard edit, view and window menus.
 *
 * @param lock - Locks the app (shows the user picker).
 */
export function installAppMenu(lock: () => void): void {
  const account: MenuItemConstructorOptions = {
    label: 'Account',
    submenu: [
      { label: 'Lock', accelerator: 'CmdOrCtrl+L', click: lock },
      { label: 'Switch user', click: lock },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : [{ role: 'fileMenu' as const }]),
    { role: 'editMenu' },
    account,
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
