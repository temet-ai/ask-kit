export const meta = { purpose: "Greet someone through the base kit", params: { name: "who" }, returns: "string" };
export default async ({ basetool }, { name = "you" }) => basetool.hello(name);
