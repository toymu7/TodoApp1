const todoInput = document.getElementById("add-text");
const todoForm = document.getElementById("todo-form");
const incompleteList = document.getElementById("imcomplete-list");
const completeList = document.getElementById("complete-list");
const statusMessage = document.getElementById("status-message");
const storageKey = "todoapp1.todos";
let isComposing = false;

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

/** Todoの状態から一覧を描画する。 */
const renderTodos = () => {
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
      todo.completed = !todo.completed;
      saveTodos();
      renderTodos();
      const targetList = todo.completed ? completeList : incompleteList;
      const index = todos.filter((item) => item.completed === todo.completed).indexOf(todo);
      targetList.children[index].querySelector("button").focus();
    });
    actions.appendChild(toggleButton);
    if (!todo.completed) {
      actions.appendChild(createButton("削除", () => {
        todos = todos.filter((item) => item.id !== todo.id);
        saveTodos();
        renderTodos();
        todoInput.focus();
      }));
    }
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
