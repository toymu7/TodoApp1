const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
const storageKey = "todoapp1.todos";

// DOMの必要な操作だけを再現する。ブラウザ固有のレイアウトは別途確認する。
function boot({ stored, readError = false, writeError = false, storage } = {}) {
  const values = storage || new Map(stored === undefined ? [] : [[storageKey, stored]]);
  const document = {
    activeElement: null,
    createElement(tag) { return new Element(tag); },
    getElementById(id) { return elements[id]; }
  };
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.listeners = {};
      this.textContent = "";
      this.value = "";
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    dispatch(type, properties = {}) {
      const event = { ...properties, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; } };
      for (const callback of this.listeners[type] || []) callback(event);
      return event;
    }
    querySelector(selector) {
      for (const child of this.children) {
        if (child.tagName === selector) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    }
    focus() { document.activeElement = this; }
  }
  const elements = Object.fromEntries([
    ["add-text", "input"], ["todo-form", "form"], ["imcomplete-list", "ul"],
    ["complete-list", "ul"], ["status-message", "p"]
  ].map(([id, tag]) => [id, new Element(tag)]));
  vm.runInNewContext(source, { document, localStorage: {
    getItem(key) { if (readError) throw new Error("denied"); return values.get(key) ?? null; },
    setItem(key, value) { if (writeError) throw new Error("quota"); values.set(key, value); }
  } });
  return {
    input: elements["add-text"], form: elements["todo-form"],
    incomplete: elements["imcomplete-list"], complete: elements["complete-list"],
    status: elements["status-message"], document, storage: values,
    add(text) { this.input.value = text; return this.form.dispatch("submit"); }
  };
}
const rowText = (list) => list.children.map((row) => row.children[0].textContent);
const buttons = (row) => row.children[1].children;

test("submit adds a trimmed Todo, clears input, and restores focus", () => {
  const app = boot();
  assert.equal(app.add("  買い物　").defaultPrevented, true);
  assert.deepEqual(rowText(app.incomplete), ["買い物"]);
  assert.equal(app.input.value, "");
  assert.equal(app.document.activeElement, app.input);
  const saved = JSON.parse(app.storage.get(storageKey));
  assert.equal(saved[0].text, "買い物");
  assert.equal(saved[0].completed, false);
  assert.equal(typeof saved[0].id, "string");
});

test("empty, ASCII whitespace, and Japanese whitespace inputs are rejected", () => {
  const app = boot();
  for (const text of ["", " \t\n", "　　", " \t　 "]) app.add(text);
  assert.equal(app.incomplete.children.length, 0);
  assert.equal(app.storage.has(storageKey), false);
});

test("completion, return, and deletion preserve remaining Todos and save state", () => {
  const app = boot();
  app.add("first");
  app.add("second");
  buttons(app.incomplete.children[0])[0].dispatch("click");
  assert.deepEqual(rowText(app.incomplete), ["second"]);
  assert.deepEqual(rowText(app.complete), ["first"]);
  assert.equal(JSON.parse(app.storage.get(storageKey))[0].completed, true);
  assert.equal(app.document.activeElement, buttons(app.complete.children[0])[0]);
  buttons(app.complete.children[0])[0].dispatch("click");
  assert.deepEqual(rowText(app.incomplete), ["first", "second"]);
  assert.equal(app.complete.children.length, 0);
  buttons(app.incomplete.children[0])[1].dispatch("click");
  assert.deepEqual(rowText(app.incomplete), ["second"]);
  assert.deepEqual(JSON.parse(app.storage.get(storageKey)).map((todo) => todo.text), ["second"]);
  assert.equal(app.document.activeElement, app.input);
});

test("completed Todos can be deleted directly and stay deleted after restart", () => {
  const app = boot();
  app.add("pending");
  app.add("done");
  app.add("keep completed");
  buttons(app.incomplete.children[1])[0].dispatch("click");
  buttons(app.incomplete.children[1])[0].dispatch("click");
  const deleteButton = buttons(app.complete.children[0])[1];
  assert.equal(deleteButton.textContent, "削除");
  deleteButton.dispatch("click");
  assert.deepEqual(rowText(app.incomplete), ["pending"]);
  assert.deepEqual(rowText(app.complete), ["keep completed"]);
  assert.equal(app.document.activeElement, app.input);
  assert.deepEqual(JSON.parse(app.storage.get(storageKey)).map((todo) => todo.text),
    ["pending", "keep completed"]);
  const restored = boot({ storage: app.storage });
  assert.deepEqual(rowText(restored.incomplete), ["pending"]);
  assert.deepEqual(rowText(restored.complete), ["keep completed"]);
});

test("restart restores text and completion from persisted storage", () => {
  const original = boot();
  original.add("pending");
  original.add("done");
  buttons(original.incomplete.children[1])[0].dispatch("click");
  const restored = boot({ storage: original.storage });
  assert.deepEqual(rowText(restored.incomplete), ["pending"]);
  assert.deepEqual(rowText(restored.complete), ["done"]);
  buttons(restored.complete.children[0])[0].dispatch("click");
  assert.deepEqual(rowText(restored.incomplete), ["pending", "done"]);
});

test("corrupt JSON and denied reads do not prevent adding Todos", () => {
  for (const options of [{ stored: "{broken" }, { readError: true }]) {
    const app = boot(options);
    assert.match(app.status.textContent, /読み込めません/);
    app.add("new");
    assert.deepEqual(rowText(app.incomplete), ["new"]);
  }
});

test("invalid records and duplicate IDs are excluded when restoring", () => {
  const app = boot({ stored: JSON.stringify([
    null, { id: "valid", text: "keep", completed: false },
    { id: "valid", text: "duplicate", completed: true },
    { id: "blank", text: "　", completed: false },
    { id: "wrong", text: "wrong", completed: "true" },
    { id: 123, text: "wrong id", completed: false },
    { id: "done", text: "finished", completed: true }
  ]) });
  assert.deepEqual(rowText(app.incomplete), ["keep"]);
  assert.deepEqual(rowText(app.complete), ["finished"]);
  assert.equal(boot({ stored: "{}" }).incomplete.children.length, 0);
});

test("denied writes show feedback while all in-memory operations continue", () => {
  const app = boot({ writeError: true });
  app.add("unsaved");
  assert.match(app.status.textContent, /保存できません/);
  buttons(app.incomplete.children[0])[0].dispatch("click");
  assert.deepEqual(rowText(app.complete), ["unsaved"]);
  buttons(app.complete.children[0])[0].dispatch("click");
  buttons(app.incomplete.children[0])[1].dispatch("click");
  assert.equal(app.incomplete.children.length, 0);
  assert.equal(app.storage.has(storageKey), false);
});

test("IME composition suppresses submission and Enter default action", () => {
  const app = boot();
  app.input.value = "変換中";
  app.input.dispatch("compositionstart");
  assert.equal(app.input.dispatch("keydown", { key: "Enter" }).defaultPrevented, true);
  app.form.dispatch("submit");
  assert.equal(app.incomplete.children.length, 0);
  assert.equal(app.input.value, "変換中");
  app.input.dispatch("compositionend");
  for (const properties of [{ isComposing: true }, { keyCode: 229 }]) {
    assert.equal(app.input.dispatch("keydown", { key: "Enter", ...properties }).defaultPrevented, true);
  }
  assert.equal(app.input.dispatch("keydown", { key: "Enter" }).defaultPrevented, false);
  app.form.dispatch("submit");
  assert.deepEqual(rowText(app.incomplete), ["変換中"]);
});
