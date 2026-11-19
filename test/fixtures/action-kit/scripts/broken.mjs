export const meta = {
  purpose: "a post's full roster (always fails: the fixture's broken script)",
  params: { post: "string, a post name" },
  returns: "never returns",
  example: 'scripts.run("broken", { post: "Cable Street" })',
};

export default async (_g, { post } = {}) => {
  throw new Error(`the roster book for ${post} is missing`);
};
