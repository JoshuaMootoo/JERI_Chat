
import React from 'react';
import { SUPPORTED_LANGUAGES } from '../constants';

interface LanguageSelectorProps {
  value: string;
  onChange: (languageCode: string) => void;
  className?: string;
  name?: string;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ value, onChange, className, name }) => {
  return (
    <select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`block w-full px-4 py-3 text-indigo-950 font-black bg-white border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer ${className}`}
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code} className="text-indigo-950 font-bold">
          {lang.name} ({lang.nativeName})
        </option>
      ))}
    </select>
  );
};

export default LanguageSelector;
