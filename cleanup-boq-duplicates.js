/**
 * Cleanup duplicate boqDocuments per folder.
 * Paste into the browser console while logged in as admin.
 *
 * For each folder, it keeps the document with the most costItems (then most
 * recently updated) and deletes the rest. Prints a dry-run summary first;
 * call cleanupBoqDuplicates(true) to actually delete.
 */
window.cleanupBoqDuplicates = async function (commit = false) {
    const uid = window.currentDataUserId || (window.currentUser && window.currentUser.uid);
    if (!uid) { console.error('Not logged in.'); return; }

    const snap = await db.collection('boqDocuments').where('userId', '==', uid).get();
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`Found ${all.length} total boqDocuments for user.`);

    // Group by folderId
    const byFolder = {};
    all.forEach(d => {
        const k = d.folderId || '(no-folder)';
        (byFolder[k] = byFolder[k] || []).push(d);
    });

    const toDelete = [];
    Object.entries(byFolder).forEach(([folderId, docs]) => {
        if (docs.length <= 1) return;
        const sorted = docs.slice().sort((a, b) => {
            const ac = (a.costItems || []).length;
            const bc = (b.costItems || []).length;
            if (ac !== bc) return bc - ac;
            const at = a.updatedAt && a.updatedAt.toMillis ? a.updatedAt.toMillis() : 0;
            const bt = b.updatedAt && b.updatedAt.toMillis ? b.updatedAt.toMillis() : 0;
            return bt - at;
        });
        const keep = sorted[0];
        const drop = sorted.slice(1);
        console.log(`Folder ${folderId}: keep ${keep.id} (${(keep.costItems||[]).length} items), drop ${drop.length}:`,
                    drop.map(d => `${d.id} (${(d.costItems||[]).length} items)`));
        toDelete.push(...drop);
    });

    if (!toDelete.length) { console.log('No duplicates to delete.'); return; }
    if (!commit) {
        console.warn(`DRY RUN. ${toDelete.length} doc(s) would be deleted. Run cleanupBoqDuplicates(true) to actually delete.`);
        return;
    }
    for (const d of toDelete) {
        await db.collection('boqDocuments').doc(d.id).delete();
        console.log('Deleted', d.id);
    }
    console.log(`Done. Deleted ${toDelete.length} duplicate doc(s).`);
};

console.log('cleanupBoqDuplicates() loaded. Run cleanupBoqDuplicates() for dry-run, cleanupBoqDuplicates(true) to commit.');
