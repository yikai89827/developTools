// 设计模式速查模块
// 23 种 GoF 设计模式卡片：场景 + 代码骨架 + 搜索

function $(id) { return document.getElementById(id); }

const PATTERNS = [
  // ── 创建型 ──
  { cat: 'creational', name: '单例模式', en: 'Singleton', desc: '确保一个类只有一个实例，并提供全局访问点', scene: '数据库连接池、配置管理、日志器、缓存' },
  { cat: 'creational', name: '工厂方法', en: 'Factory Method', desc: '定义创建对象的接口，让子类决定实例化哪个类', scene: '多种日志输出方式、跨平台 UI 控件创建' },
  { cat: 'creational', name: '抽象工厂', en: 'Abstract Factory', desc: '创建一系列相关或相互依赖的对象', scene: '跨平台 UI 套件（按钮+输入框+滚动条）、数据库多方言' },
  { cat: 'creational', name: '建造者', en: 'Builder', desc: '将复杂对象的构建与表示分离', scene: 'SQL 查询构造器、HTTP 请求构建、配置对象' },
  { cat: 'creational', name: '原型模式', en: 'Prototype', desc: '通过克隆已有实例来创建新对象', scene: '深拷贝复杂对象、模板复用' },

  // ── 结构型 ──
  { cat: 'structural', name: '适配器', en: 'Adapter', desc: '将一个接口转换成客户端期望的另一个接口', scene: '旧 API 适配新接口、第三方 SDK 兼容' },
  { cat: 'structural', name: '桥接', en: 'Bridge', desc: '将抽象部分与实现部分分离，使它们可独立变化', scene: '跨平台图形渲染、消息多渠道发送' },
  { cat: 'structural', name: '组合', en: 'Composite', desc: '将对象组合成树形结构表示整体-部分', scene: '文件系统、UI 组件树、组织架构' },
  { cat: 'structural', name: '装饰器', en: 'Decorator', desc: '动态地给对象添加额外职责', scene: 'IO 流包装、日志增强、权限校验嵌套' },
  { cat: 'structural', name: '外观', en: 'Facade', desc: '为复杂子系统提供统一接口', scene: '封装复杂第三方库、简化子系统调用' },
  { cat: 'structural', name: '享元', en: 'Flyweight', desc: '共享细粒度对象以减少内存', scene: '对象池、字符串常量池、棋盘格子' },
  { cat: 'structural', name: '代理', en: 'Proxy', desc: '为其他对象提供代理以控制访问', scene: '懒加载、远程代理、权限控制、缓存代理' },

  // ── 行为型 ──
  { cat: 'behavioral', name: '责任链', en: 'Chain of Responsibility', desc: '将请求沿处理者链传递，直到处理', scene: '中间件、审批流、事件冒泡、过滤器' },
  { cat: 'behavioral', name: '命令', en: 'Command', desc: '将请求封装为对象，支持撤销/排队', scene: '撤销重做、任务队列、宏命令' },
  { cat: 'behavioral', name: '解释器', en: 'Interpreter', desc: '定义语言的文法并解释执行', scene: '规则引擎、SQL 解析、表达式计算' },
  { cat: 'behavioral', name: '迭代器', en: 'Iterator', desc: '顺序访问集合元素而不暴露内部结构', scene: '遍历各种容器、流式处理' },
  { cat: 'behavioral', name: '中介者', en: 'Mediator', desc: '用中介对象封装多个对象间的交互', scene: '聊天室、事件总线、UI 组件通信' },
  { cat: 'behavioral', name: '备忘录', en: 'Memento', desc: '在不破坏封装的前提下保存对象状态', scene: '游戏存档、事务回滚、快照恢复' },
  { cat: 'behavioral', name: '观察者', en: 'Observer', desc: '一对多依赖，对象状态变化自动通知', scene: '事件订阅、MVVM 双向绑定、消息广播' },
  { cat: 'behavioral', name: '状态', en: 'State', desc: '对象状态改变时行为也跟着改变', scene: '订单流程、状态机、角色权限切换' },
  { cat: 'behavioral', name: '策略', en: 'Strategy', desc: '定义算法族，使它们可互相替换', scene: '支付方式、排序策略、折扣计算' },
  { cat: 'behavioral', name: '模板方法', en: 'Template Method', desc: '定义算法骨架，子类重写各步骤', scene: '框架钩子、生命周期钩子、构建流程' },
  { cat: 'behavioral', name: '访问者', en: 'Visitor', desc: '在不改变元素类的前提下定义新操作', scene: 'AST 遍历、报表生成、编译器优化' },
];

const CAT_LABELS = {
  creational: '🏭 创建型',
  structural: '🏗️ 结构型',
  behavioral: '🎯 行为型',
};

const CODE_SNIPPETS = {
  Singleton: `class Singleton {
  static instance = null;
  static getInstance() {
    if (!Singleton.instance) {
      Singleton.instance = new Singleton();
    }
    return Singleton.instance;
  }
}
// 使用：Singleton.getInstance()`,
  'Factory Method': `class Logger { log(msg) {} }
class ConsoleLogger extends Logger { log(msg) { console.log(msg); } }
class FileLogger extends Logger { log(msg) { fs.writeFile('log', msg); } }
class LoggerFactory {
  createLogger(type) {
    if (type === 'console') return new ConsoleLogger();
    if (type === 'file') return new FileLogger();
  }
}`,
  'Abstract Factory': `class UIFactory { createButton() {} createInput() {} }
class WinFactory extends UIFactory {
  createButton() { return new WinButton(); }
  createInput() { return new WinInput(); }
}
class MacFactory extends UIFactory {
  createButton() { return new MacButton(); }
  createInput() { return new MacInput(); }
}`,
  Builder: `class QueryBuilder {
  constructor() { this.q = {}; }
  select(cols) { this.q.select = cols; return this; }
  from(table) { this.q.from = table; return this; }
  where(cond) { this.q.where = cond; return this; }
  build() { return this.q; }
}
// new QueryBuilder().select('*').from('user').where('id=1').build()`,
  Prototype: `class Template {
  constructor(config) { this.config = config; }
  clone() { return new Template(JSON.parse(JSON.stringify(this.config))); }
}
const proto = new Template({theme:'dark'});
const copy = proto.clone();`,
  Adapter: `class OldPrinter { printRaw(data) { /*旧接口*/ } }
class PrinterAdapter {
  constructor(printer) { this.printer = printer; }
  print(text) { this.printer.printRaw(text.getBytes()); } // 新接口转旧
}`,
  Bridge: `class Renderer { render(shape) {} }
class VectorRenderer extends Renderer { render(s){ /*矢量*/ } }
class RasterRenderer extends Renderer { render(s){ /*位图*/ } }
class Shape { constructor(r){ this.renderer = r; } draw(){ this.renderer.render(this); } }`,
  Composite: `class Component {
  constructor(name){ this.name = name; }
  add(c){} display(){}
}
class Leaf extends Component { display(){ console.log(this.name); } }
class Folder extends Component {
  constructor(name){ super(name); this.children = []; }
  add(c){ this.children.push(c); }
  display(){ this.children.forEach(c => c.display()); }
}`,
  Decorator: `class Coffee { cost(){ return 10; } }
class MilkDecorator {
  constructor(c){ this.c = c; }
  cost(){ return this.c.cost() + 2; }
}
// new MilkDecorator(new Coffee()).cost() // 12`,
  Facade: `class Computer {
  start(){ CPU.boot(); Memory.load(); Disk.spin(); }
  // 客户端只需 computer.start()，不用关心子系统
}`,
  Flyweight: `class TreeType {
  constructor(name,color){ this.name = name; this.color = color; } // 共享
}
class TreeFactory {
  static types = {};
  static get(name, color) {
    const key = name + color;
    if (!this.types[key]) this.types[key] = new TreeType(name, color);
    return this.types[key];
  }
}`,
  Proxy: `class ImageProxy {
  constructor(file){ this.file = file; this.img = null; }
  display() {
    if (!this.img) this.img = loadHeavyImage(this.file); // 懒加载
    this.img.show();
  }
}`,
  'Chain of Responsibility': `class Handler {
  setNext(h){ this.next = h; return h; }
  handle(req) {
    if (this.next) return this.next.handle(req);
    return null;
  }
}
class AuthHandler extends Handler {
  handle(req) {
    if (!req.token) return '未认证';
    return super.handle(req);
  }
}`,
  Command: `class PasteCommand {
  constructor(editor){ this.editor = editor; this.backup = null; }
  execute() { this.backup = this.editor.text; this.editor.text = newText; }
  undo() { this.editor.text = this.backup; }
}`,
  Interpreter: `class Context { /*变量绑定*/ }
class Expression { interpret(ctx){} }
class NumberExpr extends Expression {
  constructor(n){ this.n = n; }
  interpret(ctx){ return this.n; }
}
class AddExpr extends Expression {
  constructor(a,b){ this.a=a; this.b=b; }
  interpret(ctx){ return this.a.interpret(ctx) + this.b.interpret(ctx); }
}`,
  Iterator: `class ArrayIterator {
  constructor(arr){ this.arr = arr; this.pos = 0; }
  hasNext(){ return this.pos < this.arr.length; }
  next(){ return this.arr[this.pos++]; }
}`,
  Mediator: `class ChatMediator {
  constructor(){ this.users = []; }
  register(u){ this.users.push(u); u.mediator = this; }
  send(msg, from) { this.users.forEach(u => { if (u !== from) u.receive(msg); }); }
}`,
  Memento: `class EditorMemento { constructor(state){ this.state = state; } }
class Editor {
  setState(s){ this.state = s; }
  save(){ return new EditorMemento(this.state); }
  restore(m){ this.state = m.state; }
}`,
  Observer: `class Subject {
  constructor(){ this.observers = []; }
  subscribe(fn){ this.observers.push(fn); }
  notify(data){ this.observers.forEach(fn => fn(data)); }
}`,
  State: `class OrderState {
  constructor(order){ this.order = order; }
  next(){} cancel(){}
}
class PaidState extends OrderState {
  next(){ this.order.setState(new ShippedState(this.order)); }
}
class Order {
  constructor(){ this.state = new PendingState(this); }
  setState(s){ this.state = s; }
  next(){ this.state.next(); }
}`,
  Strategy: `class PaymentStrategy { pay(amount){} }
class Alipay extends PaymentStrategy { pay(a){ /*支付宝*/ } }
class Wechat extends PaymentStrategy { pay(a){ /*微信*/ } }
class Cart {
  setStrategy(s){ this.strategy = s; }
  checkout(amount){ this.strategy.pay(amount); }
}`,
  'Template Method': `class BuildPipeline {
  run() {            // 模板方法（固定骨架）
    this.clean();
    this.compile();
    this.test();
    this.package();
  }
  clean(){}          // 钩子，子类重写
  compile(){}
  test(){}
  package(){}
}`,
  Visitor: `class Visitor { visitElement(e){} }
class HTMLVisitor extends Visitor {
  visitElement(e) {
    if (e.type === 'div') console.log('处理 div');
  }
}
class Element { accept(v){ v.visitElement(this); } }`,
};

function initDesignPatterns() {
  const container = $('pattern-list');
  const search = $('pattern-search');
  if (!container) return;
  let currentCat = 'all';

  function render() {
    const kw = search.value.trim().toLowerCase();
    const filtered = PATTERNS.filter(p => {
      if (currentCat !== 'all' && p.cat !== currentCat) return false;
      if (!kw) return true;
      return p.name.toLowerCase().includes(kw) || p.en.toLowerCase().includes(kw) ||
        p.desc.toLowerCase().includes(kw) || p.scene.toLowerCase().includes(kw);
    });

    // 按分类分组
    const groups = {};
    for (const p of filtered) {
      if (!groups[p.cat]) groups[p.cat] = [];
      groups[p.cat].push(p);
    }

    let html = '';
    for (const cat of Object.keys(groups)) {
      html += `<h3 class="pattern-cat-title">${CAT_LABELS[cat]}</h3>`;
      html += `<div class="pattern-grid">`;
      for (const p of groups[cat]) {
        const code = CODE_SNIPPETS[p.en] || '// 暂无示例';
        html += `<div class="pattern-card" data-en="${p.en}">`;
        html += `<div class="pattern-card-head">`;
        html += `<span class="pattern-name">${p.name}</span>`;
        html += `<span class="pattern-en">${p.en}</span>`;
        html += `</div>`;
        html += `<p class="pattern-desc">${p.desc}</p>`;
        html += `<p class="pattern-scene"><strong>场景：</strong>${p.scene}</p>`;
        html += `<details class="pattern-code-wrap"><summary>查看代码骨架</summary>`;
        html += `<pre class="pattern-code"><code>${escapeHtml(code)}</code></pre>`;
        html += `</details>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    container.innerHTML = html || '<div class="git-empty">无匹配模式</div>';
  }

  const filterBar = $('pattern-filter-bar');
  if (filterBar) {
    const cats = [{ key: 'all', label: '全部' }].concat(
      Object.keys(CAT_LABELS).map(k => ({ key: k, label: CAT_LABELS[k] }))
    );
    filterBar.innerHTML = cats.map(c =>
      `<button class="git-filter-btn ${c.key === 'all' ? 'active' : ''}" data-cat="${c.key}">${c.label}</button>`
    ).join('');
    filterBar.querySelectorAll('.git-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterBar.querySelectorAll('.git-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCat = btn.dataset.cat;
        render();
      });
    });
  }

  search.addEventListener('input', render);
  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { initDesignPatterns };
