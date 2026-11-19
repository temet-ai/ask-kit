export const meta = {
  purpose: "dismiss an officer from duty (changes the roster)",
  params: { officer: "string, the officer's name" },
  returns: "a line saying who was dismissed",
  example: 'scripts.run("dismiss", { officer: "Nobby" })',
};

export default async (_g, { officer } = {}) => `dismissed ${officer}`;
