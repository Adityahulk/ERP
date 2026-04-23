export function formatMoney(amountPaise: number | undefined): string {
    if (amountPaise === undefined || amountPaise === null) return '₹0.00';
    return `₹${amountPaise.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCurrency(amount: number): string {
    return formatMoney(amount); 
}

export function formatCurrencyCompact(amount: number): string {
    const abs = Math.abs(amount);
    if(abs >= 100000) return `₹${(amount/100000).toFixed(1)}L`;
    if(abs >= 1000) return `₹${(amount/1000).toFixed(1)}K`;
    return `₹${amount}`;
}

export function indianNumberFormat(n: number): string {
    return n.toLocaleString('en-IN');
}

export function formatDate(dateString: string | undefined): string {
   if (!dateString) return '-';
   const d = new Date(dateString);
   return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatRelativeTime(dateString: string | undefined): string {
    if (!dateString) return '-';
    const d = new Date(dateString);
    const ms = new Date().getTime() - d.getTime();
    const days = Math.floor(ms / (1000*3600*24));
    if(days === 0) return 'Today';
    if(days === 1) return 'Yesterday';
    if(days < 30) return `${days} days ago`;
    return formatDate(dateString);
}

export function formatQuantity(qty: number, unit: string): string {
    return `${qty} ${unit || 'Pcs'}`;
}

export function formatGST(cgst: number, sgst: number, igst: number): string {
    const total = cgst + sgst + igst;
    if(igst > 0) return `GST ${total}% (IGST ${igst}%)`;
    return `GST ${total}% (CGST ${cgst}% + SGST ${sgst}%)`;
}
