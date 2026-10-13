const todoInput = document.getElementById("add-text");
const todoForm = document.getElementById("todo-form");
const incompleteList = document.getElementById("imcomplete-list");
const completeList = document.getElementById("complete-list");
const statusMessage = document.getElementById("status-message");
const storageKey = "todoapp1.todos";
let isComposing = false;
let activeEdit = null;

/** 保存済みデータを検証し、利用できるTodoだけを復元する。 */
const loadTodos = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    const ids = new Set();
    return saved.filter((todo) => {
      const valid = todo && typeof todo.id === "string" && !ids.has(todo.id)
        && typeof todo.text === "string" && todo.text.trim()
        && typeof todo.completed === "boolean";
      if (valid) ids.add(todo.id);
      return valid;
    });
  } catch {
    statusMessage.textContent = "保存データを読み込めませんでした。";
    return [];
  }
};
let todos = loadTodos();

/** 保存できない場合も操作を続けられるようにし、利用者へ通知する。 */
const saveTodos = () => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(todos));
    statusMessage.textContent = "";
  } catch {
    statusMessage.textContent = "保存できませんでした。再読み込みすると変更が失われます。";
  }
};

/** クリック時の処理を受け取り、ボタンを生成する。 */
const createButton = (label, onClick) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};

/** 編集を確定する。空白だけの内容やキャンセル時は元の本文を維持する。 */
const finishEditing = (cancel = false) => {
  if (!activeEdit) return;
  const { todo, editor, text, editButton } = activeEdit;
  activeEdit = null;
  const value = editor.value.trim();
  if (!cancel && value && value !== todo.text) {
    todo.text = value;
    saveTodos();
  }
  text.replaceChildren();
  text.textContent = todo.text;
  editButton.textContent = "編集";
};

/** 本文を編集欄に切り替え、すぐに入力できるようにする。 */
const startEditing = (todo, text, actions, editButton) => {
  finishEditing();
  const editor = document.createElement("input");
  editor.type = "text";
  editor.className = "todo-editor";
  editor.value = todo.text;
  editor.setAttribute("aria-label", "Todoの内容を編集");
  let composing = false;
  editor.addEventListener("compositionstart", () => { composing = true; });
  editor.addEventListener("compositionend", () => { composing = false; });
  editor.addEventListener("blur", (event) => {
    if (activeEdit && activeEdit.editor === editor && !actions.contains(event.relatedTarget)) {
      finishEditing();
    }
  });
  editor.addEventListener("keydown", (event) => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      finishEditing(event.key === "Escape");
      editButton.focus();
    }
  });
  text.textContent = "";
  text.replaceChildren(editor);
  editButton.textContent = "保存";
  activeEdit = { todo, editor, text, actions, editButton };
  editor.focus();
  editor.select();
};

// フォーカスを受け取らない余白をクリックした場合も編集を確定する。
document.addEventListener("pointerdown", (event) => {
  if (!activeEdit || event.target === activeEdit.editor) return;
  if (activeEdit.actions.contains(event.target)) {
    // blurによる先行保存を防ぎ、押されたボタンに確定・取消の判断を任せる。
    event.preventDefault();
    return;
  }
  finishEditing();
});

/** Todoの状態から一覧を描画する。 */
const renderTodos = () => {
  finishEditing();
  incompleteList.replaceChildren();
  completeList.replaceChildren();
  todos.forEach((todo) => {
    const row = document.createElement("li");
    row.className = "list-row";
    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = todo.text;
    const actions = document.createElement("div");
    actions.className = "todo-actions";
    const toggleButton = createButton(todo.completed ? "戻す" : "完了", () => {
      finishEditing();
      todo.completed = !todo.completed;
      saveTodos();
      renderTodos();
      const targetList = todo.completed ? completeList : incompleteList;
      const index = todos.filter((item) => item.completed === todo.completed).indexOf(todo);
      targetList.children[index].querySelector("button").focus();
    });
    actions.appendChild(toggleButton);
    const deleteButton = createButton("削除", () => {
      finishEditing(activeEdit && activeEdit.todo === todo);
      todos = todos.filter((item) => item.id !== todo.id);
      saveTodos();
      renderTodos();
      todoInput.focus();
    });
    actions.appendChild(deleteButton);
    const editButton = createButton("編集", () => {
      if (activeEdit && activeEdit.todo === todo) {
        finishEditing();
        editButton.focus();
      } else {
        startEditing(todo, text, actions, editButton);
      }
    });
    actions.appendChild(editButton);
    row.appendChild(text);
    row.appendChild(actions);
    (todo.completed ? completeList : incompleteList).appendChild(row);
  });
};

/** 変換中や空白だけの入力を除き、Todoを追加して保存する。 */
const addTodo = (event) => {
  event.preventDefault();
  if (isComposing) return;
  const text = todoInput.value.trim();
  if (!text) {
    todoInput.focus();
    return;
  }
  todos.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text, completed: false });
  saveTodos();
  renderTodos();
  todoInput.value = "";
  todoInput.focus();
};

todoInput.addEventListener("compositionstart", () => { isComposing = true; });
todoInput.addEventListener("compositionend", () => { isComposing = false; });
todoInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.isComposing || isComposing || event.keyCode === 229)) {
    event.preventDefault();
  }
});
todoForm.addEventListener("submit", addTodo);
renderTodos();
