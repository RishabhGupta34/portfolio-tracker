import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(num, decimals = 2) {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(num);
}

export function formatDate(dateString) {
  if (!dateString) return 'N/A';
  
  // Handle DD-MM-YYYY format (from MFAPI)
  if (dateString.includes('-') && dateString.split('-')[0].length <= 2) {
    const [day, month, year] = dateString.split('-');
    dateString = `${year}-${month}-${day}`;
  }
  
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString; // Return original if invalid
  
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Format currency for chart axes (compact format)
export function formatCurrencyCompact(value) {
  if (value >= 10000000) {
    // Crores
    return `₹${(value / 10000000).toFixed(1)}Cr`;
  } else if (value >= 100000) {
    // Lakhs
    return `₹${(value / 100000).toFixed(1)}L`;
  } else if (value >= 1000) {
    // Thousands
    return `₹${(value / 1000).toFixed(1)}K`;
  }
  return `₹${value.toFixed(0)}`;
}
