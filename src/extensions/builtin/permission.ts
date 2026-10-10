// 身份与权限落地实现（FR01「组织数据隔离」）
// - InMemoryIdentityProvider：从事实库解析成员
// - OrgIsolationPermissionEvaluator：强制「同组织才能访问同组织资源」这一边界
import type { ID, IdentityProvider, Member, PermissionEvaluator } from '../index.ts';
import type { Store } from '../../engine/store.ts';

export class InMemoryIdentityProvider implements IdentityProvider {
  readonly id = 'in-memory';
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async resolveMember(memberId: ID): Promise<Member | null> {
    for (const org of this.store.organizations.values()) {
      const m = org.members.find((x) => x.id === memberId);
      if (m) return m;
    }
    return null;
  }
}

export class OrgIsolationPermissionEvaluator implements PermissionEvaluator {
  readonly id = 'org-isolation';
  private store: Store;
  private identity: IdentityProvider;

  constructor(store: Store, identity: IdentityProvider) {
    this.store = store;
    this.identity = identity;
  }

  async can(actorId: ID, _action: string, resourceId: ID): Promise<boolean> {
    const member = await this.identity.resolveMember(actorId);
    if (!member) return false;
    const orgId = this.resolveOrg(resourceId);
    return orgId !== undefined && member.orgId === orgId;
  }

  /** 资源 id → 所属组织 id（组织/项目/需求/节点都可定位） */
  private resolveOrg(resourceId: ID): ID | undefined {
    if (this.store.organizations.has(resourceId)) return resourceId;
    const p = this.store.projects.get(resourceId);
    if (p) return p.orgId;
    const r = this.store.requirements.get(resourceId);
    if (r) return this.store.projects.get(r.projectId)?.orgId;
    const n = this.store.nodes.get(resourceId);
    if (n) return this.store.projects.get(n.projectId)?.orgId;
    return undefined;
  }
}
