export type Tech = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  tradeSkills: string[];
  hourlyRate: number | null;
  userId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
