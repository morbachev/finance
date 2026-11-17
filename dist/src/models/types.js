export const CARDS = [
    { id: 'rakuten-mizuho', name: 'みずほ楽天カード', provider: 'rakuten' },
    { id: 'rakuten-etc', name: '楽天カード（ETC利用分）', provider: 'rakuten' },
    { id: 'recruit-jcb', name: 'リクルートカード（JCB）', provider: 'jcb' },
    { id: 'bic-suica', name: 'ビックカメラSuicaカード', provider: 'view' },
    { id: 'smbc-nl', name: '三井住友カード NL', provider: 'smbc' },
    { id: 'amazon', name: 'Amazonカード', provider: 'smbc' },
    { id: 'goldpoint', name: 'GOLD POINT CARD+', provider: 'goldpoint' },
];
export function getCard(id) {
    return CARDS.find(card => card.id === id);
}
export function calculatedTotal(statement) {
    return statement.rows.reduce((sum, row) => sum + row.amount, 0);
}
