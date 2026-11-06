/** GTEki-authored fictional game configuration, not station data. */
const interactable = {
  shopId: "ph-ikb-b1e-12",
  steps: [
    { id: "look", seconds: 1.2 },
    { id: "sit", seconds: 1.5 },
    { id: "react", seconds: 1.2 },
    { id: "give", seconds: 1.0 },
  ],
  reward: "paper-bag",
  once: true,
} satisfies { shopId: string; steps: { id: string; seconds: number }[]; reward: string; once: boolean };

export default interactable;
