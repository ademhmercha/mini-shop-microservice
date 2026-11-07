const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const formatPrice = (cents) => euro.format((cents ?? 0) / 100);

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
export const formatDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '');
export const formatDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '');

export const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export const ORDER_STATUS = {
  pending: 'À régler sur place',
  ready: 'Prête',
  completed: 'Retirée',
  cancelled: 'Annulée',
};
