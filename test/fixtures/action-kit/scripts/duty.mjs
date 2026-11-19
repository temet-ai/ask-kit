export const meta = {
  purpose: "who is on duty at a post",
  params: { post: "string, a post name (default Pseudopolis Yard)" },
  returns: "{ post, officers }",
  example: 'scripts.run("duty", { post: "Cable Street" })',
};

export default async ({ watch }, { post = "Pseudopolis Yard" } = {}) => ({ post, officers: watch.onDuty(post) });
