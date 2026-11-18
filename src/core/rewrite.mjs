// Turns a REPL cell into a script whose top-level names outlive the cell.
//
// The cell runs inside an async function so it can use `await`. Top-level `const`, `let`, `var`,
// `function` and `class` declarations would then be local to that function, so they become
// assignments to the context's global object instead, where later cells and the snapshot see them.
// The value of a final expression statement is returned as the cell's result.
import * as acorn from "acorn";

function patternNames(node, out) {
  if (!node) return out;
  switch (node.type) {
    case "Identifier":
      out.push(node.name);
      break;
    case "ObjectPattern":
      for (const p of node.properties) patternNames(p.type === "RestElement" ? p.argument : p.value, out);
      break;
    case "ArrayPattern":
      for (const e of node.elements) patternNames(e?.type === "RestElement" ? e.argument : e, out);
      break;
    case "AssignmentPattern":
      patternNames(node.left, out);
      break;
    case "RestElement":
      patternNames(node.argument, out);
      break;
  }
  return out;
}

export function rewriteCell(code) {
  const ast = acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });
  const edits = []; // [start, end, replacement], applied back to front
  const declared = [];
  const body = ast.body;

  for (const stmt of body) {
    if (stmt.type === "VariableDeclaration") {
      const parts = stmt.declarations.map((d) => {
        patternNames(d.id, declared);
        const target = code.slice(d.id.start, d.id.end);
        const value = d.init ? code.slice(d.init.start, d.init.end) : "undefined";
        return d.id.type === "Identifier"
          ? `globalThis.${target} = (${value});`
          : `(${target} = (${value}));`;
      });
      // Destructured names must exist as globals before a sloppy-mode pattern assignment.
      const pre = stmt.declarations
        .filter((d) => d.id.type !== "Identifier")
        .flatMap((d) => patternNames(d.id, []))
        .map((n) => `globalThis.${n} = undefined;`)
        .join(" ");
      edits.push([stmt.start, stmt.end, `${pre} ${parts.join(" ")}`.trim()]);
    } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
      declared.push(stmt.id.name);
      edits.push([stmt.start, stmt.end, `globalThis.${stmt.id.name} = (${code.slice(stmt.start, stmt.end)});`]);
    } else if (stmt.type === "ClassDeclaration" && stmt.id) {
      declared.push(stmt.id.name);
      edits.push([stmt.start, stmt.end, `globalThis.${stmt.id.name} = (${code.slice(stmt.start, stmt.end)});`]);
    }
  }

  const last = body[body.length - 1];
  if (last && last.type === "ExpressionStatement") {
    const expr = code.slice(last.expression.start, last.expression.end);
    edits.push([last.start, last.end, `return (${expr});`]);
  }

  let out = code;
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + text + out.slice(end);
  }
  return { script: `(async () => {\n${out}\n})()`, declared };
}
