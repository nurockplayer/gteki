/** GTEki-authored fictional game configuration, not station data. */
const interactables = [{
  shopId: "ph-ikb-b1e-12",
  steps: [
    { id: "look", seconds: 1.2 },
    { id: "sit", seconds: 1.5 },
    { id: "react", seconds: 1.2 },
    { id: "give", seconds: 1.0 },
  ],
  reward: "paper-bag",
  once: true,
}, {
  shopId: "ph-ikb-b1e-01",
  steps: [{ id: "look", seconds: 1.2 }, { id: "react", seconds: 1.3 }, { id: "give", seconds: 0.8 }],
  reward: "cafe-cup",
  once: false,
  autoStart: true,
}, {
  shopId: "ph-ikb-b1e-05",
  steps: [{ id: "look", seconds: 1.2 }, { id: "react", seconds: 1.3 }, { id: "give", seconds: 0.8 }],
  reward: "bookmark",
  once: false,
  autoStart: true,
}] satisfies { shopId: string; steps: { id: string; seconds: number }[]; reward: string; once: boolean; autoStart?: boolean }[];

export default interactables;
