'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 只暴露一个受限的调用入口,渲染进程无法直接访问 Node / 文件系统。
contextBridge.exposeInMainWorld('api', {
  call: (method, payload) => ipcRenderer.invoke('api', method, payload),
});
