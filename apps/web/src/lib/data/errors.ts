/**
 * Live mode is selected but no backend exists yet.
 *
 * This error is the entire point of the data seam. The prototype's demo/live
 * toggle wrote an audit entry claiming the data source had changed and then
 * carried on showing demo data behind a badge reading LIVE. A view that
 * receives this renders an honest empty state instead.
 */
export class LiveModeNotAvailableError extends Error {
  readonly moduleId: string;

  constructor(moduleId: string) {
    super(`Live data for ${moduleId} is not connected yet.`);
    this.name = 'LiveModeNotAvailableError';
    this.moduleId = moduleId;
  }
}
