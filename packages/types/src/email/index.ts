/**
 * Every email body the site sends, in one place.
 *
 * apps/web sends the address-confirmation mail inline from a server action;
 * apps/worker sends everything else out of the outbox drains. Both render from
 * here, so a change to the layout lands in both without a second edit.
 */
export * from './layout'
export * from './grant-alerts'
export * from './approvals'
export * from './urls'
