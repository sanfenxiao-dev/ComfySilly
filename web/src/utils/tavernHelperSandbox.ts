/**
 * Legacy entry point. The former injected runtime was incomplete and unsafe.
 * Use the presentation pipeline; this module deliberately executes no card code.
 */
export {
  applyDisplayRules,
  splitMessageParts,
  inspectFrontend,
  buildStaticPreview,
  getHelperScripts,
} from './messagePresentation';
