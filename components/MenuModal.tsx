
import React from 'react';
import { MENU_ITEMS } from '../constants';
import type { MenuItem } from '../types';

interface MenuModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MenuItemCard: React.FC<{ item: MenuItem }> = ({ item }) => (
  <div className="bg-gray-800 rounded-lg overflow-hidden shadow-lg transform hover:scale-105 transition-transform duration-300">
    <img className="w-full h-40 object-cover" src={item.image} alt={item.name} />
    <div className="p-4">
      <h3 className="text-lg font-semibold text-white">{item.name}</h3>
      <p className="text-gray-400 text-sm mt-1">{item.description}</p>
      <p className="text-amber-400 font-bold mt-2">{item.price}</p>
    </div>
  </div>
);

const MenuModal: React.FC<MenuModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const categories = ['Entradas', 'Platos de Fondo', 'Postres', 'Bebidas'];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-gray-900 text-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] overflow-y-auto p-8 relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl">&times;</button>
        <h2 className="text-4xl font-serif text-amber-400 text-center mb-8">Nuestra Carta</h2>
        
        {categories.map(category => (
          <div key={category} className="mb-10">
            <h3 className="text-2xl font-bold text-white border-b-2 border-amber-500 pb-2 mb-6">{category}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {MENU_ITEMS.filter(item => item.category === category).map(item => (
                <MenuItemCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MenuModal;
