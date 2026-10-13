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
  const writes = [];
  const document = {
    activeElement: null,
    listeners: {},
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); },
    dispatch(type, properties = {}) {
      const event = { ...properties, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; } };
      for (const callback of this.listeners[type] || []) callback(event);
      return event;
    },
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
    select() { this.selected = true; }
    setAttribute(name, value) { this[name] = value; }
    contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
  }
  const elements = Object.fromEntries([
    ["add-text", "input"], ["todo-form", "form"], ["imcomplete-list", "ul"],
    ["complete-list", "ul"], ["status-message", "p"]
  ].map(([id, tag]) => [id, new Element(tag)]));
  vm.runInNewContext(source, { document, localStorage: {
    getItem(key) { if (readError) throw new Error("denied"); return values.get(key) ?? null; },
    setItem(key, value) {
      if (writeError) throw new Error("quota");
      writes.push(JSON.parse(value));
      values.set(key, value);
    }
  } });
  return {
    input: elements["add-text"], form: elements["todo-form"],
    incomplete: elements["imcomplete-list"], complete: elements["complete-list"],
    status: elements["status-message"], document, storage: values, writes,
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

for (const completed of [false, true]) {
  test(`inline editing saves on outside click and restores after restart (completed=${completed})`, () => {
    const app = boot();
    app.add("original");
    app.add("untouched");
    if (completed) buttons(app.incomplete.children[0])[0].dispatch("click");
    const list = completed ? app.complete : app.incomplete;
    const row = list.children[0];
    const editButton = buttons(row)[2];
    assert.equal(editButton.textContent, "編集");
    editButton.dispatch("click");
    const editor = row.querySelector("input");
    assert.equal(editor.value, "original");
    assert.equal(app.document.activeElement, editor);
    assert.equal(editor.selected, true);
    editor.value = "  edited　";
    app.document.dispatch("pointerdown", { target: editor });
    assert.equal(row.querySelector("input"), editor);
    app.document.dispatch("pointerdown", { target: list });
    assert.equal(row.querySelector("input"), null);
    assert.equal(row.children[0].textContent, "edited");
    assert.equal(buttons(row)[0].textContent, completed ? "戻す" : "完了");
    const restored = boot({ storage: app.storage });
    assert.deepEqual(rowText(completed ? restored.complete : restored.incomplete),
      completed ? ["edited"] : ["edited", "untouched"]);
    assert.ok(rowText(restored.incomplete).includes("untouched"));
  });
}

test("blank edits preserve original text, blur saves, and Escape cancels", () => {
  const app = boot();
  app.add("original");
  const row = app.incomplete.children[0];
  const editButton = buttons(row)[2];
  editButton.dispatch("click");
  let editor = row.querySelector("input");
  editor.value = "　 ";
  editor.dispatch("blur");
  assert.equal(row.children[0].textContent, "original");
  editButton.dispatch("click");
  editor = row.querySelector("input");
  editor.value = "cancelled";
  assert.equal(editor.dispatch("keydown", { key: "Escape" }).defaultPrevented, true);
  assert.equal(row.children[0].textContent, "original");
  assert.equal(app.document.activeElement, editButton);
  editButton.dispatch("click");
  editor = row.querySelector("input");
  editor.value = "saved by blur";
  editor.dispatch("blur");
  assert.equal(row.children[0].textContent, "saved by blur");
  assert.equal(JSON.parse(app.storage.get(storageKey))[0].text, "saved by blur");
});

test("editing Enter confirms only outside IME composition", () => {
  const app = boot();
  app.add("original");
  const row = app.incomplete.children[0];
  buttons(row)[2].dispatch("click");
  const editor = row.querySelector("input");
  editor.value = "日本語";
  editor.dispatch("compositionstart");
  editor.dispatch("keydown", { key: "Enter" });
  assert.equal(row.querySelector("input"), editor);
  editor.dispatch("compositionend");
  for (const properties of [{ isComposing: true }, { keyCode: 229 }]) {
    editor.dispatch("keydown", { key: "Enter", ...properties });
    assert.equal(row.querySelector("input"), editor);
  }
  assert.equal(editor.dispatch("keydown", { key: "Enter" }).defaultPrevented, true);
  assert.equal(row.children[0].textContent, "日本語");
});

test("editing then clicking complete or delete does not block the action", () => {
  const app = boot();
  app.add("original");
  let row = app.incomplete.children[0];
  buttons(row)[2].dispatch("click");
  row.querySelector("input").value = "edited";
  const completeButton = buttons(row)[0];
  app.document.dispatch("pointerdown", { target: completeButton });
  completeButton.dispatch("click");
  assert.deepEqual(rowText(app.complete), ["edited"]);
  row = app.complete.children[0];
  buttons(row)[2].dispatch("click");
  row.querySelector("input").value = "before deleting";
  const deleteButton = buttons(row)[1];
  app.document.dispatch("pointerdown", { target: deleteButton });
  deleteButton.dispatch("click");
  assert.deepEqual(rowText(app.complete), []);
  assert.deepEqual(JSON.parse(app.storage.get(storageKey)), []);
});

for (const completed of [false, true]) {
  test(`save and delete controls keep three buttons during editing (completed=${completed})`, () => {
    const app = boot();
    app.add("original");
    if (completed) buttons(app.incomplete.children[0])[0].dispatch("click");
    const row = (completed ? app.complete : app.incomplete).children[0];
    const saveButton = buttons(row)[2];
    const deleteButton = buttons(row)[1];
    assert.equal(deleteButton.textContent, "削除");
    assert.equal(buttons(row).length, 3);
    saveButton.dispatch("click");
    assert.equal(saveButton.textContent, "保存");
    assert.equal(deleteButton.textContent, "削除");
    assert.equal(buttons(row).length, 3);
    let editor = row.querySelector("input");
    editor.value = "saved explicitly";
    const pointer = app.document.dispatch("pointerdown", { target: saveButton });
    assert.equal(pointer.defaultPrevented, true);
    editor.dispatch("blur", { relatedTarget: saveButton });
    assert.equal(row.querySelector("input"), editor);
    saveButton.dispatch("click");
    assert.equal(row.children[0].textContent, "saved explicitly");
    assert.equal(saveButton.textContent, "編集");
    assert.equal(deleteButton.textContent, "削除");
    assert.equal(buttons(row).length, 3);
    saveButton.dispatch("click");
    editor = row.querySelector("input");
    editor.value = "discard this";
    const writeCount = app.writes.length;
    editor.dispatch("keydown", { key: "Escape" });
    assert.equal(row.children[0].textContent, "saved explicitly");
    assert.equal(app.writes.length, writeCount);
    assert.equal(app.document.activeElement, saveButton);
    assert.equal(saveButton.textContent, "編集");
    assert.equal(deleteButton.textContent, "削除");
    assert.equal(buttons(row).length, 3);
    const restored = boot({ storage: app.storage });
    assert.deepEqual(rowText(completed ? restored.complete : restored.incomplete), ["saved explicitly"]);
  });
}

test("deleting during editing discards the draft without saving it first", () => {
  const app = boot();
  app.add("original");
  app.add("keep");
  const row = app.incomplete.children[0];
  buttons(row)[2].dispatch("click");
  const editor = row.querySelector("input");
  editor.value = "discarded draft";
  const deleteButton = buttons(row)[1];
  const writeCount = app.writes.length;
  app.document.dispatch("pointerdown", { target: deleteButton });
  editor.dispatch("blur", { relatedTarget: deleteButton });
  deleteButton.dispatch("click");
  assert.equal(app.writes.length, writeCount + 1);
  assert.ok(app.writes.every((items) => items.every((todo) => todo.text !== "discarded draft")));
  assert.deepEqual(rowText(app.incomplete), ["keep"]);
});

test("keyboard completion and return commit the draft before changing state", () => {
  const app = boot();
  app.add("original");
  for (const list of [app.incomplete, app.complete]) {
    const row = list.children[0];
    buttons(row)[2].dispatch("click");
    const editor = row.querySelector("input");
    editor.value = list === app.incomplete ? "completed edit" : "returned edit";
    const toggle = buttons(row)[0];
    editor.dispatch("blur", { relatedTarget: toggle });
    toggle.dispatch("click");
    const saved = JSON.parse(app.storage.get(storageKey))[0];
    assert.equal(saved.text, editor.value);
    assert.equal(saved.completed, list === app.incomplete);
  }
  assert.deepEqual(rowText(app.incomplete), ["returned edit"]);
});
