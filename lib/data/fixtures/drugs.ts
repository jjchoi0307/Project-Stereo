import type { Drug } from "@/lib/domain";

/** Synthetic normalized drug list. Codes are made-up RxNorm-like ids. */
export const drugs: Drug[] = [
  { id: "rx-metformin", name: "metformin", therapeuticClass: "biguanide" },
  { id: "rx-empagliflozin", name: "empagliflozin", therapeuticClass: "SGLT2 inhibitor" },
  { id: "rx-insulin-glargine", name: "insulin glargine", therapeuticClass: "long-acting insulin" },
  { id: "rx-atorvastatin", name: "atorvastatin", therapeuticClass: "statin" },
  { id: "rx-lisinopril", name: "lisinopril", therapeuticClass: "ACE inhibitor" },
  { id: "rx-sertraline", name: "sertraline", therapeuticClass: "SSRI" },
  { id: "rx-zolpidem", name: "zolpidem", therapeuticClass: "sedative-hypnotic" },
  { id: "rx-albuterol", name: "albuterol", therapeuticClass: "bronchodilator" },
  { id: "rx-pembrolizumab", name: "pembrolizumab", therapeuticClass: "oncology immunotherapy" },
];
