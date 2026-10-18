// Tiny arithmetic expression evaluator for card text such as "X + X" or
// "printed.life - 2". Supports numbers, dotted names, + - * /, parentheses,
// unary minus, and max()/min(). No side effects.

export type Scope = Record<string, any>;

export function evaluate(src: number | string | undefined, scope: Scope): number {
  if (src === undefined) return 0;
  if (typeof src === "number") return src;
  const toks = src.match(/\d+|[A-Za-z_][\w.]*|[-+*/(),]/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];

  const primary = (): number => {
    const t = take();
    if (t === undefined) throw new Error(`Unexpected end of expression: ${src}`);
    if (t === "(") {
      const v = sum();
      take();
      return v;
    }
    if (t === "-") return -primary();
    if (/^\d+$/.test(t)) return Number(t);
    if (t === "max" || t === "min") {
      take(); // (
      const args = [sum()];
      while (peek() === ",") {
        take();
        args.push(sum());
      }
      take(); // )
      return t === "max" ? Math.max(...args) : Math.min(...args);
    }
    const v = t.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), scope);
    // Variables not currently being played count as 0 (v2.2 "Numbers" rule 3).
    return typeof v === "number" ? v : 0;
  };
  const product = (): number => {
    let v = primary();
    while (peek() === "*" || peek() === "/") v = take() === "*" ? v * primary() : Math.floor(v / primary());
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") v = take() === "+" ? v + product() : v - product();
    return v;
  };
  return sum();
}
