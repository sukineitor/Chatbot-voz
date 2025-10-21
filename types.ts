
export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price: string;
  category: 'Entradas' | 'Platos de Fondo' | 'Postres' | 'Bebidas';
  image: string;
}
