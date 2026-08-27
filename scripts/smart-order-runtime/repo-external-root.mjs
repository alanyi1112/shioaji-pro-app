import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = realpathSync(
    path.resolve(fileURLToPath(new URL('../../', import.meta.url))),
);

function inside(parent, candidate) {
    return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function rejectRepositoryPath(candidate, label) {
    if (inside(REPOSITORY_ROOT, candidate)) {
        throw new Error(`${label} must remain outside the source repository`);
    }
}

export function assertLexicallyRepoExternalRoot(value, label = 'private root') {
    if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
        throw new TypeError(`${label} must be an explicit absolute path`);
    }
    const normalized = path.resolve(value);
    if (normalized === path.parse(normalized).root) {
        throw new TypeError(`${label} may not be a filesystem root`);
    }
    rejectRepositoryPath(normalized, label);
    return normalized;
}

export async function assertRepoExternalRoot(value, label = 'private root') {
    const normalized = assertLexicallyRepoExternalRoot(value, label);
    let existingAncestor = normalized;
    const missingSegments = [];
    let resolvedAncestor;

    for (;;) {
        try {
            resolvedAncestor = await realpath(existingAncestor);
            break;
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            const parent = path.dirname(existingAncestor);
            if (parent === existingAncestor) throw error;
            missingSegments.unshift(path.basename(existingAncestor));
            existingAncestor = parent;
        }
    }

    const physicalCandidate = path.resolve(
        resolvedAncestor,
        ...missingSegments,
    );
    rejectRepositoryPath(physicalCandidate, label);
    return normalized;
}

export function smartOrderRepositoryRootForTest() {
    return REPOSITORY_ROOT;
}
