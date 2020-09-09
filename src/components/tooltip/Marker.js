/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import * as React from 'react';
import classNames from 'classnames';
import {
  formatNumber,
  formatMilliseconds,
  formatTimestamp,
} from '../../utils/format-numbers';
import explicitConnect from '../../utils/connect';
import {
  getThreadSelectors,
  getMarkerSchemaByName,
  getImplementationFilter,
  getPageList,
  getZeroAt,
  getThreadIdToNameMap,
  getMarkerLabelMakerByName,
} from 'firefox-profiler/selectors';

import {
  TooltipNetworkMarkerPhases,
  getNetworkMarkerDetails,
} from './NetworkMarker';
import {
  TooltipDetails,
  TooltipDetail,
  type TooltipDetailComponent,
} from './TooltipDetails';
import Backtrace from '../shared/Backtrace';

import { bailoutTypeInformation } from '../../profile-logic/marker-info';
import {
  formatFromMarkerSchema,
  getMarkerLabelMaker,
  getMarkerSchema,
  getMarkerSchemaName,
} from '../../profile-logic/marker-schema';

import type {
  Milliseconds,
  Marker,
  ImplementationFilter,
  Thread,
  ThreadIndex,
  PageList,
  MarkerSchemaByName,
  MarkerLabelMakerByName,
} from 'firefox-profiler/types';

import type { ConnectedProps } from '../../utils/connect';
import {
  getGCMinorDetails,
  getGCMajorDetails,
  getGCSliceDetails,
} from './GCMarker';

function _maybeFormatDuration(
  start: number | void,
  end: number | void
): string {
  if (start !== undefined && end !== undefined) {
    return formatMilliseconds(end - start);
  }
  return 'unknown';
}

type OwnProps = {|
  +marker: Marker,
  +threadIndex: ThreadIndex,
  +className?: string,
|};

type StateProps = {|
  +threadName?: string,
  +thread: Thread,
  +implementationFilter: ImplementationFilter,
  +pages: PageList | null,
  +zeroAt: Milliseconds,
  +threadIdToNameMap: Map<number, string>,
  +markerSchemaByName: MarkerSchemaByName,
  +markerLabelMakerByName: MarkerLabelMakerByName,
|};

type Props = ConnectedProps<OwnProps, StateProps, {||}>;

/**
 * This component combines Marker Schema, and custom handling to generate tooltips
 * for markers.
 */
class MarkerTooltipContents extends React.PureComponent<Props> {
  _maybeRenderPageUrl = (): TooltipDetailComponent => {
    const { pages, marker } = this.props;

    if (!(pages && marker.data && marker.data.innerWindowID)) {
      return null;
    }

    const innerWindowID = marker.data.innerWindowID;
    const page = pages.find(page => page.innerWindowID === innerWindowID);

    if (page) {
      return <TooltipDetail label="URL">{page.url}</TooltipDetail>;
    }
    return null;
  };

  /**
   * Either print the thread name that marker is in, or get the thread name from
   * the threadId field if it's given. The second case is useful when a marker
   * belongs to another thread but in this thread for some limitations in the
   * platform side. For example, FileIO marker may belong to another thread if
   * they have threadId field.
   */
  _renderThreadDetails(): TooltipDetailComponent[] {
    const { marker, threadName, threadIdToNameMap } = this.props;
    const data = marker.data;

    if (!data || data.threadId === undefined) {
      return [
        <TooltipDetail label="Thread" key="thread">
          {threadName}
        </TooltipDetail>,
      ];
    }

    const threadId = data.threadId;
    const occurringThreadName = threadIdToNameMap.get(threadId);

    return [
      <TooltipDetail label="Recording Thread" key="recording">
        {threadName}
      </TooltipDetail>,
      // If we have the thread information of the occurring thread, then show.
      // Otherwise, only show the thread ID.
      occurringThreadName ? (
        <TooltipDetail
          label="Occurring Thread"
          key="occurring"
        >{`${occurringThreadName} (TID: ${threadId})`}</TooltipDetail>
      ) : (
        <TooltipDetail label="Occurring Thread ID" key="occurring">
          {threadId}
        </TooltipDetail>
      ),
    ];
  }

  /**
   * This function combines the Marker Schema formatting, and custom handling of
   * properties that are difficult to represent with the Schema.
   */
  _renderMarkerDetails(): TooltipDetailComponent[] {
    const { marker, markerSchemaByName } = this.props;
    const data = marker.data;
    const details: TooltipDetailComponent[] = [];

    if (data) {
      // Add the details for the markers based on their Marker schema.
      const schema = getMarkerSchema(markerSchemaByName, marker);
      if (schema) {
        for (const schemaData of schema.data) {
          // Check for a schema that is looking up and formatting a value from
          // the payload.
          if (schemaData.value === undefined) {
            const { key, label, format } = schemaData;
            if (key in data) {
              details.push(
                <TooltipDetail
                  key={schema.name + '-' + key}
                  label={label || key}
                >
                  {formatFromMarkerSchema(schema.name, format, data[key])}
                </TooltipDetail>
              );
            }
          }

          // Do a check to see if there is no key. This means this is a simple
          // label that is applied to every marker of this type, with no data
          // lookup. For some reason Flow as not able to refine this.
          if (schemaData.key === undefined) {
            const { label, value } = schemaData;
            const key = label + '-' + value;
            details.push(
              <TooltipDetail key={key} label={label}>
                {value}
              </TooltipDetail>
            );
          }
        }
      }

      switch (data.type) {
        case 'GCMinor': {
          // The GC schema is mostly ignored.
          details.push(...getGCMinorDetails(data));
          break;
        }
        case 'GCMajor': {
          // The GC schema is mostly ignored.
          details.push(...getGCMajorDetails(data));
          break;
        }
        case 'GCSlice': {
          // The GC schema is mostly ignored.
          details.push(...getGCSliceDetails(data));
          break;
        }
        case 'Bailout': {
          details.push(
            // Bailout also has marker schema, but it's helpful to look up the bailout
            // reason.
            <TooltipDetail label="Description" key="Bailout-Description">
              <div style={{ maxWidth: '300px' }}>
                {bailoutTypeInformation['Bailout_' + data.bailoutType]}
              </div>
            </TooltipDetail>
          );
          break;
        }
        case 'Network': {
          // Network markers embed lots of timing information inside of them, that
          // must be reworked in the tooltip.
          details.push(...getNetworkMarkerDetails(data));
          break;
        }
        case 'tracing': {
          // The DOMEvent markers include a latency that is computed from a timestamp
          // and the marker start time.
          if (data.category === 'DOMEvent') {
            const latency =
              data.timeStamp === undefined
                ? null
                : formatMilliseconds(marker.start - data.timeStamp);
            details.push(
              <TooltipDetail label="Latency" key="tracing-Latency">
                {latency}
              </TooltipDetail>
            );
          }
          break;
        }
        case 'IPC': {
          // The logic to subtract times to create durations is not supported by
          // the marker schema. Use custom handling for these in addition to
          // the other properties supported by the Marker Schema.
          details.push(
            <TooltipDetail
              label="Send Thread Latency"
              key="IPC-Send Thread Latency"
            >
              {_maybeFormatDuration(data.startTime, data.sendStartTime)}
            </TooltipDetail>,
            <TooltipDetail
              label="IPC Send Duration"
              key="IPC-IPC Send Duration"
            >
              {_maybeFormatDuration(data.sendStartTime, data.sendEndTime)}
            </TooltipDetail>,
            <TooltipDetail label="IPC Recv Latency" key="IPC-IPC Recv Latency">
              {_maybeFormatDuration(data.sendEndTime, data.recvEndTime)}
            </TooltipDetail>,
            <TooltipDetail
              label="Recv Thread Latency"
              key="IPC-Recv Thread Latency"
            >
              {_maybeFormatDuration(data.recvEndTime, data.endTime)}
            </TooltipDetail>
          );
          break;
        }
        default:
        // Do nothing
      }
    }

    return details;
  }

  _maybeRenderMarkerDuration() {
    const { marker } = this.props;
    if (marker.end === null) {
      return null;
    }

    // We only know the duration if it's complete.
    const duration = marker.incomplete
      ? 'unknown duration'
      : formatTimestamp(marker.end - marker.start, 3, 1);

    return <div className="tooltipTiming">{duration}</div>;
  }

  _maybeRenderBacktrace() {
    const { marker, thread, implementationFilter } = this.props;
    const { data, start } = marker;
    if (data && 'cause' in data && data.cause) {
      const { cause } = data;
      const causeAge = start - cause.time;
      return (
        <div className="tooltipDetailsBackTrace" key="backtrace">
          {data.type === 'Styles' || marker.name === 'Reflow' ? (
            <h2 className="tooltipBackTraceTitle">
              First invalidated {formatNumber(causeAge)}ms before the flush, at:
            </h2>
          ) : null}
          <Backtrace
            maxHeight="30em"
            stackIndex={cause.stack}
            thread={thread}
            implementationFilter={implementationFilter}
          />
        </div>
      );
    }
    return null;
  }

  _maybeRenderNetworkPhases() {
    const {
      marker: { data },
      zeroAt,
    } = this.props;
    if (data && data.type === 'Network') {
      return <TooltipNetworkMarkerPhases payload={data} zeroAt={zeroAt} />;
    }
    return null;
  }

  _renderTitle(): string {
    const { marker, markerLabelMakerByName } = this.props;
    const { data } = marker;
    if (data) {
      // Add the details for the markers based on their Marker schema.
      const applyLabel = markerLabelMakerByName[getMarkerSchemaName(marker)];
      if (applyLabel) {
        return applyLabel(data);
      }
    }

    // Fallback to the title or the marker name.
    return marker.title || marker.name;
  }

  /**
   * Often-times component logic is split out into several different components. This
   * is really helpful for interactive components, as each list of Props serves as
   * a piece of memoization that can help with not over-rendering.
   *
   * This component is a little bit different, as it will only be rendered once per
   * marker, as it's hovered. In addition, most of the complexity is in generating
   * a list of TooltipDetailComponent, which are label/value pairs. Many parts
   * of the tooltip are controlled by the Marker Schema, however there are some
   * custom implementations for various markers that include some complexity.
   * The general practice here is to provide functions of the signature:
   *
   * Payload => TooltipDetailComponent[]
   *
   * These TooltipDetailComponent are then combined with those generated by the
   * Marker Schema.
   *
   * Finally, many sections are optional based on the data that is present. Note
   * that these render function begin with "maybe", rather than embedded complicated
   * ternaries everywhere. This leads to a style of render function that includes
   * a short list of rendering strategies, in the order they appear.
   */
  render() {
    return (
      <div className={classNames('tooltipMarker', this.props.className)}>
        <div className="tooltipHeader">
          <div className="tooltipOneLine">
            {this._maybeRenderMarkerDuration()}
            <div className="tooltipTitle">{this._renderTitle()}</div>
          </div>
        </div>
        <TooltipDetails>
          {this._renderThreadDetails()}
          {this._maybeRenderPageUrl()}
          {this._renderMarkerDetails()}
        </TooltipDetails>
        {this._maybeRenderBacktrace()}
        {this._maybeRenderNetworkPhases()}
      </div>
    );
  }
}

export const TooltipMarker = explicitConnect<OwnProps, StateProps, {||}>({
  mapStateToProps: (state, props) => {
    const selectors = getThreadSelectors(props.threadIndex);
    return {
      threadName: selectors.getFriendlyThreadName(state),
      thread: selectors.getThread(state),
      implementationFilter: getImplementationFilter(state),
      pages: getPageList(state),
      zeroAt: getZeroAt(state),
      threadIdToNameMap: getThreadIdToNameMap(state),
      markerSchemaByName: getMarkerSchemaByName(state),
      markerLabelMakerByName: getMarkerLabelMakerByName(state),
    };
  },
  component: MarkerTooltipContents,
});
