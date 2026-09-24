const { spawn } = require('node:child_process');
const readline = require('node:readline');
class NativeChannel {
  constructor(file, title, executable, owner, parent = process.pid) {
    this.pending = []; this.closed = false;
    this.child = spawn(file, [title, executable, String(parent), String(owner)], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', error => this.fail(error));
    readline.createInterface({ input: this.child.stdout }).on('line', line => {
      const next = this.pending.shift(); if (!next) return;
      clearTimeout(next.timer);
      try { const data = JSON.parse(line); data.ok ? next.resolve(data) : next.reject(new Error(data.error || '原生桥失败')); }
      catch (e) { next.reject(e); }
    });
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('WE 原生窗口桥已停止')));
  }
  fail(error) {
    this.closed = true;
    for (const item of this.pending.splice(0)) { clearTimeout(item.timer); item.reject(error); }
  }
  request(data) {
    if (this.closed) return Promise.reject(new Error('原生桥已关闭'));
    if (this.pending.length > 8) return Promise.reject(new Error('原生桥繁忙'));
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { this.fail(new Error('原生桥响应超时')); this.child.kill(); }, 3000);
      this.pending.push({resolve,reject,timer});
      this.child.stdin.write(JSON.stringify(data)+'\n');
    });
  }
  close() {
    if (this.closed) return;
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 1500); timer.unref();
    this.child.once('exit', () => clearTimeout(timer));
    this.fail(new Error('原生桥已关闭'));
  }
}
module.exports = { NativeChannel };
