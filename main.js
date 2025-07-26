import { app, BrowserWindow } from "electron";

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
  });
  win.setMenuBarVisibility(false);
  win.loadFile("index.html");
};

app.whenReady().then(() => {
  createWindow();
});
