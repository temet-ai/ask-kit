// The fixture kit's one global: a made-up duty roster.
const ROSTER = {
  "Pseudopolis Yard": ["Sam Vimes", "Carrot Ironfoundersson"],
  "Cable Street": ["Angua"],
};

export const make = () => ({
  posts: () => Object.keys(ROSTER),
  onDuty: (post) => ROSTER[post] ?? [],
});
