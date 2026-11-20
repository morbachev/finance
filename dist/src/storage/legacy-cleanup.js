export async function verifyLegacyMigration(legacy, cloud, localSource, cloudSource) {
    if (!legacy.length)
        throw new Error('旧明細がありません。');
    const current = new Map(cloud.map(row => [row.id, row]));
    let sources = 0;
    for (const old of legacy) {
        const remote = current.get(old.id);
        if (!remote)
            throw new Error('OneDriveに未移行の明細があります。旧データは残してください。');
        if (JSON.stringify(old.statement) !== JSON.stringify(remote.statement))
            throw new Error('旧明細とOneDriveの内容が一致しません。旧データは残してください。');
        if (old.hasSource) {
            const [a, b] = await Promise.all([localSource(old.id), cloudSource(old.id)]);
            if (!a || !b || a.length !== b.length || a.some((byte, i) => byte !== b[i]))
                throw new Error('PDF原本の照合に失敗しました。旧データは残してください。');
            sources++;
        }
    }
    return { statementCount: legacy.length, sourceCount: sources };
}
/** The selected backup must be the exact encrypted copy produced in this session. */
export async function verifyDownloadedBackup(expected, selected) {
    if (expected.size !== selected.size || !expected.size)
        return false;
    const [a, b] = await Promise.all([expected.arrayBuffer(), selected.arrayBuffer()]);
    const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', a), crypto.subtle.digest('SHA-256', b)]);
    return new Uint8Array(ha).every((x, i) => x === new Uint8Array(hb)[i]);
}
