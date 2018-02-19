/**
 * Copyright 2018 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "VirtualTimeController" }]*/

const {VirtualTimeController, VirtualTimeContinuePolicy, VirtualTimeStartPolicy, VirtualTimeRepeatingTask, VirtualTimeObserver} = require('./VirtualTimeController');

class CompositorController {
  /**
   * @param {!Puppeteer.CDPSession} client
   * @param {!VirtualTimeController} virtualTimeController
   * @param {!Object} options
   */
  constructor(client, virtualTimeController, options) {
    this._client = client;
    this._virtualTimeController = virtualTimeController;

    /** @type {number} Specifies the virtual time between individual BeginFrames while virtual time advances. */
    this._animationBeginFrameInterval = options.animationBeginFrameInterval || 100;

    /** @type {number} The real time delay between BeginFrames that are sent while waiting for the main frame compositor to become ready (real time)*/
    this.waitForCompositorReadyBeginFrameDelay = options.waitForCompositorReadyBeginFrameDelay || 20;

    /** @type {boolean} If false, animation BeginFrames will not commit or draw visual updates to the display. This can be used to reduce the overhead of such BeginFrames in the common case that screenshots will be taken from separate BeginFrames. */
    this._updateDisplayForAnimations = options.updateDisplayForAnimations || true;

    client.on('HeadlessExperimental.needsBeginFramesChanged', event => this._needsBeginFramesChanged(event));
    client.on('HeadlessExperimental.mainFrameReadyForScreenshots', event => this._mainFrameReadyForScreenshots(event));
    client.send('HeadlessExperimental.enable', {});

    const controller = this;
    this._animation_task = new class extends VirtualTimeRepeatingTask {
      constructor() {
        super();
        this._intervalElapsed = false;
        this._intervalContinueCallback = null;
        this._startContinueCallback = null;
        this._beginFrameTask = null;
        this._needsBeginFrameOnVirtualTimeResume = false;

        const repeatingTask = this;
        this._observer = new class extends VirtualTimeObserver {
          virtualTimeStarted() {
          }

          virtualTimeStopped() {
            // Wait until a new budget was requested before sending another animation
            // BeginFrame, as it's likely that we will send a screenshotting BeginFrame.
            if (repeatingTask._beginFrameTask) {
              clearImmediate(repeatingTask._beginFrameTask);
              repeatingTask._beginFrameTask = null;
              repeatingTask._needsBeginFrameOnVirtualTimeResume = true;
              repeatingTask._beginFrameComplete();
            }
          }
        }();
        virtualTimeController.addObserver(this._observer);

        virtualTimeController.setStartDeferrer(this.deferStart.bind(this));
        virtualTimeController.scheduleRepeatingTask(
            this, controller._animationBeginFrameInterval, -1,
            VirtualTimeStartPolicy.START_IMMEDIATELY);
        // Note we wait for something else to actually start virtual time
      }

      /** @param {!function()} continueCallback */
      deferStart(continueCallback) {
        // Run a BeginFrame if we cancelled it because the budged expired previously
        // and no other BeginFrame was sent while virtual time was paused.
        if (this._needsBeginFrameOnVirtualTimeResume) {
          this._startContinueCallback = continueCallback;
          this._issueAnimationBeginFrame();
          return;
        }
        continueCallback();
      }

      /**
       * @param {number} virtualTimeOffset
       * @param {!function(!string)} continueCallback
       */
      intervalElapsed(virtualTimeOffset, continueCallback) {
        this._intervalContinueCallback = continueCallback;

        // Post a cancellable task that will issue a BeginFrame. This way, we can
        // cancel sending an animation-only BeginFrame if another virtual time task
        // sends a screenshotting BeginFrame first, or if the budget was exhausted.
        this._beginFrameTask = setImmediate(this._issueAnimationBeginFrame.bind(this));
      }

      compositorControllerIssuingScreenshotBeginFrame() {
        // The screenshotting BeginFrame will replace our animation-only BeginFrame.
        // We cancel any pending animation BeginFrame to avoid sending two
        // BeginFrames within the same virtual time pause.
        this._needsBeginFrameOnVirtualTimeResume = false;
        if (this._beginFrameTask) {
          clearImmediate(this._beginFrameTask);
          this._beginFrameTask = null;
          this._beginFrameComplete();
        }
      }

      _issueAnimationBeginFrame() {
        if (this._beginFrameTask) {
          clearImmediate(this._beginFrameTask);
          this._beginFrameTask = null;
        }
        this._needsBeginFrameOnVirtualTimeResume = false;
        // No need for PostBeginFrame, since the begin_frame_task_ has already been posted above.
        controller._beginFrame(this._beginFrameComplete.bind(this), !controller._updateDisplayForAnimations);
      }

      _beginFrameComplete() {
        if (this._intervalContinueCallback) {
          this._intervalContinueCallback(VirtualTimeContinuePolicy.NOT_REQUIRED);
          this._intervalContinueCallback = null;
        }

        if (this._startContinueCallback) {
          this._startContinueCallback();
          this._startContinueCallback = null;
        }
      }
    }();

    this._compositorReadyCallback = null;

    /** @type {function(*)} */
    this._beginFrameCompleteCallback = null;

    this._mainFrameContentUpdatedCallback = null;
    this._screenshotCapturedCallback = null;
    this._idleCallback = null;
    this._lastBeginFrameTime = 0;
    this._waitForCompositorReadyBeginFrameTask = null;
    this._needsBeginFrames = false;
    this._mainFrameReady = false;
  }

  /**
   * Issues BeginFrames until the main frame's compositor has completed
   * initialization. Should not be called again until the promise resolves.
   * Should only be called while no other BeginFrame is in flight.
   * @return {Promise} A promise resolved once the compositor has completed initialization.
   */
  waitForCompositorReady() {
    // We need to wait for the mainFrameReadyForScreenshots event, which will be
    // issued once the renderer has submitted its first CompositorFrame in
    // response to a BeginFrame. At that point, we know that the renderer
    // compositor has initialized. We do this by issuing BeginFrames until we
    // receive the event. To avoid bogging down the system with a flood of
    // BeginFrames, we add a short delay between them.
    // TODO(eseckler): Investigate if we can remove the need for these initial
    // BeginFrames and the mainFrameReadyForScreenshots event, by making the
    // compositor wait for the renderer in the very first BeginFrame, even if it
    // isn't yet present in the surface hierarchy. Maybe surface synchronization
    // can help here?
    if (this._mainFrameReady)
      return Promise.resolve();

    if (this._needsBeginFrames) {
      // Post BeginFrames with a delay until the main frame becomes ready.
      this._postWaitForCompositorReadyBeginFrameTask();
    }
    return new Promise(resolve => this._compositorReadyCallback = resolve);
  }

  /**
   * Returns a promise that is resolved when no BeginFrames are in flight.
   */
  waitUntilIdle() {
    if (!this._beginFrameCompleteCallback)
      return Promise.resolve();
    return new Promise(resolve => this._idleCallback = resolve);
  }

  /**
   * Issues BeginFrames until a new main frame update was committed. Should not
   * be called again until |mainFrameContentUpdatedCallback| was run. Should
   * only be called while no other BeginFrame is in flight.
   *
   * This can be used in situations where e.g. the main frame size changes and
   * we need to wait for the update to propagate down into a new surface before
   * taking a screenshot.
   *
   * @param {!function()} mainFrameContentUpdatedCallback The callback executed
   *   once a new main frame update has been committed.
   */
  waitForMainFrameContentUpdate(mainFrameContentUpdatedCallback) {
    this._mainFrameContentUpdatedCallback = mainFrameContentUpdatedCallback;

    // Post BeginFrames until we see a main frame update.
    if (this._needsBeginFrames)
      this._postWaitForMainFrameContentUpdateBeginFrame();
  }

  /**
   * Captures a screenshot by issuing a BeginFrame. |quality| is only valid for
   * jpeg format screenshots, in range 0..100. Should not be called again until
   * the promise has resolved. Should only be called while no other BeginFrame
   * is in flight and after the compositor is ready.
   *
   * @param {string} format
   * @param {number} quality A number between 1 and 100
   * @return {Promise<>} Promise that is resolved once the screen shot has been
   *    taken.
   */
  captureScreenshot(format, quality) {
    // Let AnimationTask know that it doesn't need to issue an animation BeginFrame for the
    // current virtual time pause.
    this._animation_task.compositorControllerIssuingScreenshotBeginFrame();

    const noDisplayUpdates = false;
    this._postBeginFrame(this._captureScreenshotBeginFrameComplete.bind(this), noDisplayUpdates, {format, quality});

    return new Promise(resolve => this._screenshotCapturedCallback = resolve);
  }

  /**
   * Posts a BeginFrame as a new task to avoid nesting it inside the current callstack,
   * which can upset the compositor.
   *
   * @param {!function()} beginFrameCompleteCallback
   * @param {boolean} noDisplayUpdates
   * @param {Object} screenshot
   */
  _postBeginFrame(beginFrameCompleteCallback, noDisplayUpdates = false, screenshot = null) {
    // In certain nesting situations, we should not issue a BeginFrame immediately
    // - for example, issuing a new BeginFrame within a BeginFrameCompleted or
    // NeedsBeginFramesChanged event can upset the compositor. We avoid these
    // situations by issuing our BeginFrames from a separately posted task.
    setImmediate(this._beginFrame.bind(this, beginFrameCompleteCallback, noDisplayUpdates, screenshot));
  }

  /**
   * Issues a BeginFrame synchronously and runs |beginFrameCompleteCallback|
   * when done. Should not be called again until |beginFrameCompleteCallback| has run.
   *
   * @param {!function(*)} beginFrameCompleteCallback
   * @param {boolean} noDisplayUpdates
   * @param {Object} screenshot
   */
  _beginFrame(beginFrameCompleteCallback, noDisplayUpdates = false, screenshot = null) {
    this._beginFrameCompleteCallback = beginFrameCompleteCallback;
    if (this._needsBeginFrames || screenshot) {
      // Use virtual time for frame time, so that rendering of animations etc. is
      // aligned with virtual time progression.
      let frameTime = this._virtualTimeController.getCurrentVirtualTime();
      if (frameTime <= this._lastBeginFrameTime) {
        // Frame time cannot go backwards or stop, so we issue another BeginFrame
        // with a small time offset from the last BeginFrame's time instead.
        frameTime = this._lastBeginFrameTime + 0.001;
      }
      const params = {
        frameTime,  // frameTime.ToJsTime()
        interval: this._animationBeginFrameInterval,
        noDisplayUpdates
      };
      if (screenshot)
        params.screenshot = screenshot;
      this._lastBeginFrameTime = frameTime;
      this._client.send('HeadlessExperimental.beginFrame', params).then(this._beginFrameComplete.bind(this));
    } else {
      this._beginFrameComplete(null);
    }
  }

  /**
   * Runs the |beginFrameCompleteCallback| and the |this._idleCallback| if set.
   * @param {*} result
   */
  _beginFrameComplete(result) {
    if (this._beginFrameCompleteCallback) {
      const callback = this._beginFrameCompleteCallback;
      this._beginFrameCompleteCallback = null;
      callback(result);
    }
    if (this._idleCallback) {
      const callback = this._idleCallback;
      this._idleCallback = null;
      callback();
    }
  }

  /**
   * @param {*} event
   */
  _needsBeginFramesChanged(event) {
    this._needsBeginFrames = event.needsBeginFrames;

    // If _needsBeginFrames became true again and we're waiting for the
    // compositor or a main frame update, continue posting BeginFrames - provided
    // there's none outstanding.
    if (this._compositorReadyCallback && this._needsBeginFrames && !this._beginFrameCompleteCallback && !this._waitForCompositorReadyBeginFrameTask)
      this._postBeginFrame(this._waitForCompositorReadyBeginFrameComplete.bind(this));
    else if (this._mainFrameContentUpdatedCallback && this._needsBeginFrames && !this._beginFrameCompleteCallback)
      this._postWaitForMainFrameContentUpdateBeginFrame();
  }

  /**
   * @param {*} event
   */
  _mainFrameReadyForScreenshots(event) {  // eslint-disable-line no-unused-vars
    this._mainFrameReady = true;

    // If a waitForCompositorReadyBeginFrame is still scheduled, skip it.
    if (this._waitForCompositorReadyBeginFrameTask) {
      clearTimeout(this._waitForCompositorReadyBeginFrameTask);
      this._waitForCompositorReadyBeginFrameTask = null;

      const callback = this._compositorReadyCallback;
      this._compositorReadyCallback = null;
      callback();
    }
  }

  /**
   * Posts a task to issue a BeginFrame while waiting for the
   * mainFrameReadyForScreenshots event. The taks may be cancelled by the event.
   */
  _postWaitForCompositorReadyBeginFrameTask() {
    // We may receive the mainFrameReadyForScreenshots event before this task
    // is run. In that case, we cancel it in _mainFrameReadyForScreenshots to
    // avoid another unnecessary BeginFrame.
    this._waitForCompositorReadyBeginFrameTask = setTimeout(
        this._issueWaitForCompositorReadyBeginFrame.bind(this),
        this.waitForCompositorReadyBeginFrameDelay);
  }

  _issueWaitForCompositorReadyBeginFrame() {
    // No need for PostBeginFrame, since _waitForCompositorReadyBeginFrameTask
    // has already been posted.
    if (this._waitForCompositorReadyBeginFrameTask) {
      clearTimeout(this._waitForCompositorReadyBeginFrameTask);
      this._waitForCompositorReadyBeginFrameTask = null;
    }

    this._beginFrame(this._waitForCompositorReadyBeginFrameComplete.bind(this));
  }

  _waitForCompositorReadyBeginFrameComplete() {
    if (this._mainFrameReady) {
      const compositorReadyCallback = this._compositorReadyCallback;
      this._compositorReadyCallback = null;
      compositorReadyCallback();
      return;
    }

    // Continue posting more BeginFrames with a delay until the main frame
    // becomes ready. If needs_begin_frames_ is false, it will eventually turn
    // true again once the renderer's compositor has started up.
    if (this._needsBeginFrames)
      this._postWaitForCompositorReadyBeginFrameTask();
  }


  /**
   * Posts a BeginFrame while waiting for a main frame content update.
   */
  _postWaitForMainFrameContentUpdateBeginFrame() {
    this._postBeginFrame(this._waitForMainFrameContentUpdateBeginFrameComplete.bind(this));
  }

  _waitForMainFrameContentUpdateBeginFrameComplete(beginFrameResult) {
    if (!beginFrameResult)
      return;

    if (beginFrameResult.mainFrameContentUpdated) {
      const callback = this._mainFrameContentUpdatedCallback;
      this._mainFrameContentUpdatedCallback = null;
      callback();
      return;
    }

    // Continue posting BeginFrames until we see a main frame update.
    if (this._needsBeginFrames)
      this._postWaitForMainFrameContentUpdateBeginFrame();
  }

  _captureScreenshotBeginFrameComplete(beginFrameResult) {
    if (beginFrameResult && beginFrameResult.screenshotData) {
      const callback = this._screenshotCapturedCallback;
      this._screenshotCapturedCallback = null;
      callback(beginFrameResult.screenshotData);
    } else {
      // TODO(alexclarke): this should really be promise rejection.
      const callback = this._screenshotCapturedCallback;
      this._screenshotCapturedCallback = null;
      callback();
    }
  }
}

module.exports = CompositorController;
