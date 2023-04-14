import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { ComponentProps } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';

import { serializeStateToUrlParam } from '@grafana/data';
import { locationService, config } from '@grafana/runtime';
import { ExploreId } from 'app/types';

import { makeLogsQueryResponse } from './spec/helper/query';
import { setupExplore, tearDown, waitForExplore } from './spec/helper/setup';
import * as mainState from './state/main';
import * as queryState from './state/query';

jest.mock('app/core/core', () => {
  return {
    contextSrv: {
      hasPermission: () => true,
      hasAccess: () => true,
    },
    appEvents: {
      subscribe: () => {},
      publish: () => {},
    },
  };
});

jest.mock('react-virtualized-auto-sizer', () => {
  return {
    __esModule: true,
    default(props: ComponentProps<typeof AutoSizer>) {
      return <div>{props.children({ width: 1000, height: 1000 })}</div>;
    },
  };
});

describe('ExplorePage', () => {
  afterEach(() => {
    tearDown();
  });

  describe('Handles open/close splits and related events in UI and URL', () => {
    it('opens the split pane when split button is clicked', async () => {
      setupExplore();
      // Wait for rendering the editor
      const splitButton = await screen.findByRole('button', { name: /split/i });
      await userEvent.click(splitButton);
      await waitFor(() => {
        const editors = screen.getAllByText('loki Editor input:');
        expect(editors.length).toBe(2);
      });
    });

    it('inits with two panes if specified in url', async () => {
      const urlParams = {
        left: serializeStateToUrlParam({
          datasource: 'loki-uid',
          queries: [{ refId: 'A', expr: '{ label="value"}' }],
          range: { from: 'now-1h', to: 'now' },
        }),
        right: serializeStateToUrlParam({
          datasource: 'elastic-uid',
          queries: [{ refId: 'A', expr: 'error' }],
          range: { from: 'now-1h', to: 'now' },
        }),
      };

      const { datasources } = setupExplore({ urlParams });
      jest.mocked(datasources.loki.query).mockReturnValueOnce(makeLogsQueryResponse());
      jest.mocked(datasources.elastic.query).mockReturnValueOnce(makeLogsQueryResponse());

      // Make sure we render the logs panel
      await waitFor(() => {
        const logsPanels = screen.getAllByText(/^Logs$/);
        expect(logsPanels.length).toBe(2);
      });

      // Make sure we render the log line
      const logsLines = await screen.findAllByText(/custom log line/i);
      expect(logsLines.length).toBe(2);

      // And that the editor gets the expr from the url
      expect(screen.getByText(`loki Editor input: { label="value"}`)).toBeInTheDocument();
      expect(screen.getByText(`elastic Editor input: error`)).toBeInTheDocument();

      // We did not change the url
      expect(locationService.getSearchObject()).toEqual(urlParams);

      // We called the data source query method once
      expect(datasources.loki.query).toBeCalledTimes(1);
      expect(jest.mocked(datasources.loki.query).mock.calls[0][0]).toMatchObject({
        targets: [{ expr: '{ label="value"}' }],
      });

      expect(datasources.elastic.query).toBeCalledTimes(1);
      expect(jest.mocked(datasources.elastic.query).mock.calls[0][0]).toMatchObject({
        targets: [{ expr: 'error' }],
      });
    });

    // TODO: the following tests are using the compact format, we should use the current format instead
    // and have a dedicated test ensuring the compact format is parsed correctly
    it('can close a panel from a split', async () => {
      const urlParams = {
        left: JSON.stringify(['now-1h', 'now', 'loki', { refId: 'A' }]),
        right: JSON.stringify(['now-1h', 'now', 'elastic', { refId: 'A' }]),
      };
      setupExplore({ urlParams });
      let closeButtons = await screen.findAllByLabelText(/Close split pane/i);
      await userEvent.click(closeButtons[1]);

      await waitFor(() => {
        closeButtons = screen.queryAllByLabelText(/Close split pane/i);
        expect(closeButtons.length).toBe(0);
      });
    });

    // FIXME: Y U NO WORK? (ノಠ益ಠ)ノ彡┻━┻
    it.skip('handles url change to split view', async () => {
      const urlParams = {
        left: JSON.stringify(['now-1h', 'now', 'loki', { expr: '{ label="value"}' }]),
      };
      const { datasources, location } = setupExplore({ urlParams });
      jest.mocked(datasources.loki.query).mockReturnValue(makeLogsQueryResponse());
      jest.mocked(datasources.elastic.query).mockReturnValue(makeLogsQueryResponse());

      act(() => {
        location.partial({
          left: JSON.stringify(['now-1h', 'now', 'loki', { expr: '{ label="value"}' }]),
          right: JSON.stringify(['now-1h', 'now', 'elastic', { expr: 'error' }]),
        });
      });

      // Editor renders the new query
      expect(await screen.findByText(`loki Editor input: { label="value"}`)).toBeInTheDocument();
      expect(await screen.findByText(`elastic Editor input: error`)).toBeInTheDocument();
    });

    it('handles opening split with split open func', async () => {
      const urlParams = {
        left: JSON.stringify(['now-1h', 'now', 'loki', { expr: '{ label="value"}' }]),
      };
      const { datasources, store } = setupExplore({ urlParams });
      jest.mocked(datasources.loki.query).mockReturnValue(makeLogsQueryResponse());
      jest.mocked(datasources.elastic.query).mockReturnValue(makeLogsQueryResponse());

      // Wait for the left pane to render
      await waitFor(async () => {
        expect(await screen.findByText(`loki Editor input: { label="value"}`)).toBeInTheDocument();
      });

      act(() => {
        store.dispatch(mainState.splitOpen({ datasourceUid: 'elastic', query: { expr: 'error', refId: 'A' } }));
      });

      // Editor renders the new query
      expect(await screen.findByText(`elastic Editor input: error`)).toBeInTheDocument();
      expect(await screen.findByText(`loki Editor input: { label="value"}`)).toBeInTheDocument();
    });

    it('handles split size events and sets relevant variables', async () => {
      setupExplore();
      const splitButton = await screen.findByText(/split/i);
      userEvent.click(splitButton);
      await waitForExplore(ExploreId.left, true);

      expect(await screen.findAllByLabelText('Widen pane')).toHaveLength(2);
      expect(screen.queryByLabelText('Narrow pane')).not.toBeInTheDocument();

      const panes = screen.getAllByRole('main');

      expect(Number.parseInt(getComputedStyle(panes[0]).width, 10)).toBe(1000);
      expect(Number.parseInt(getComputedStyle(panes[1]).width, 10)).toBe(1000);
      const resizer = screen.getByRole('presentation');

      fireEvent.mouseDown(resizer, { buttons: 1 });
      fireEvent.mouseMove(resizer, { clientX: -700, buttons: 1 });
      fireEvent.mouseUp(resizer);

      expect(await screen.findAllByLabelText('Widen pane')).toHaveLength(1);
      expect(await screen.findAllByLabelText('Narrow pane')).toHaveLength(1);
    });
  });

  describe('Handles document title changes', () => {
    it('changes the document title of the explore page to include the datasource in use', async () => {
      const urlParams = {
        left: JSON.stringify(['now-1h', 'now', 'loki', { expr: '{ label="value"}' }]),
      };
      const { datasources } = setupExplore({ urlParams });
      jest.mocked(datasources.loki.query).mockReturnValue(makeLogsQueryResponse());
      // This is mainly to wait for render so that the left pane state is initialized as that is needed for the title
      // to include the datasource
      await screen.findByText(`loki Editor input: { label="value"}`);

      await waitFor(() => expect(document.title).toEqual('Explore - loki - Grafana'));
    });

    it('changes the document title to include the two datasources in use in split view mode', async () => {
      const urlParams = {
        left: JSON.stringify(['now-1h', 'now', 'loki', { expr: '{ label="value"}' }]),
      };
      const { datasources, store } = setupExplore({ urlParams });
      jest.mocked(datasources.loki.query).mockReturnValue(makeLogsQueryResponse());
      jest.mocked(datasources.elastic.query).mockReturnValue(makeLogsQueryResponse());

      // This is mainly to wait for render so that the left pane state is initialized as that is needed for splitOpen
      // to work
      await screen.findByText(`loki Editor input: { label="value"}`);

      act(() => {
        store.dispatch(mainState.splitOpen({ datasourceUid: 'elastic', query: { expr: 'error', refId: 'A' } }));
      });
      await waitFor(() => expect(document.title).toEqual('Explore - loki | elastic - Grafana'));
    });
  });

  describe('Handles different URL datasource redirects', () => {
    it('No params, no store value uses default data source', async () => {
      setupExplore();
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('No datasource in root or query and no store value uses default data source', async () => {
      setupExplore({ urlParams: 'orgId=1&left={"queries":[{"refId":"A"}],"range":{"from":"now-1h","to":"now"}}' });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A"}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('No datasource in root or query with store value uses store value data source', async () => {
      setupExplore({
        urlParams: 'orgId=1&left={"queries":[{"refId":"A"}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"elastic-uid","queries":[{"refId":"A"}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('UID datasource in root uses root data source', async () => {
      setupExplore({
        urlParams:
          'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A"}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A"}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('Name datasource in root uses root data source, converts to UID', async () => {
      setupExplore({
        urlParams: 'orgId=1&left={"datasource":"loki","queries":[{"refId":"A"}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A"}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('Datasource ref in query, none in root uses query datasource', async () => {
      setupExplore({
        urlParams:
          'orgId=1&left={"queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('Datasource ref in query with matching UID in root uses matching datasource', async () => {
      setupExplore({
        urlParams:
          'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('Datasource ref in query with matching name in root uses matching datasource, converts root to UID', async () => {
      setupExplore({
        urlParams:
          'orgId=1&left={"datasource":"loki","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('Datasource ref in query with mismatching UID in root uses query datasource', async () => {
      setupExplore({
        urlParams:
          'orgId=1&left={"datasource":"elastic-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('Different datasources in query with mixed feature on changes root to Mixed', async () => {
      config.featureToggles.exploreMixedDatasource = true;

      setupExplore({
        urlParams:
          'orgId=1&left={"datasource":"elastic-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}},{"refId":"B","datasource":{"type":"logs","uid":"elastic-uid"}}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      const reducerMock = jest.spyOn(queryState, 'queryReducer');
      await waitForExplore(undefined, true);
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(reducerMock).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'explore/queriesImported' })
      );
      // this mixed UID is weird just because of our fake datasource generator
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"--+Mixed+---uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}},{"refId":"B","datasource":{"type":"logs","uid":"elastic-uid"}}],"range":{"from":"now-1h","to":"now"}}'
      );

      config.featureToggles.exploreMixedDatasource = false;
    });

    it('Different datasources in query with mixed feature off uses first query DS, converts rest', async () => {
      config.featureToggles.exploreMixedDatasource = false;
      setupExplore({
        urlParams:
          'orgId=1&left={"datasource":"elastic-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}},{"refId":"B","datasource":{"type":"logs","uid":"elastic-uid"}}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });

      const reducerMock = jest.spyOn(queryState, 'queryReducer');
      await waitForExplore(undefined, true);
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      // because there are no import/export queries in our mock datasources, only the first one remains
      expect(reducerMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'explore/queriesImported',
          payload: expect.objectContaining({
            exploreId: 'left',
            queries: [
              expect.objectContaining({
                datasource: {
                  type: 'logs',
                  uid: 'loki-uid',
                },
              }),
            ],
          }),
        })
      );
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('Datasource in root not found and no queries changes to default', async () => {
      setupExplore({
        urlParams: 'orgId=1&left={"datasource":"asdasdasd","range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"loki-uid","queries":[{"refId":"A","datasource":{"type":"logs","uid":"loki-uid"}}],"range":{"from":"now-1h","to":"now"}}'
      );
    });

    it('Datasource root is mixed and there are two queries, one with datasource not found, only one query remains with root datasource as that datasource', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      setupExplore({
        urlParams:
          'orgId=1&left={"datasource":"-- Mixed --","queries":[{"refId":"A","datasource":{"type":"asdf","uid":"asdf"}},{"refId":"B","datasource":{"type":"logs","uid":"elastic-uid"}}],"range":{"from":"now-1h","to":"now"}}',
        prevUsedDatasource: { orgId: 1, datasource: 'elastic' },
      });
      await waitForExplore();
      const urlParams = decodeURIComponent(locationService.getSearch().toString());
      expect(urlParams).toBe(
        'orgId=1&left={"datasource":"elastic-uid","queries":[{"refId":"B","datasource":{"type":"logs","uid":"elastic-uid"}}],"range":{"from":"now-1h","to":"now"}}'
      );
      expect(consoleErrorSpy).toBeCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });
  });

  it('removes `from` and `to` parameters from url when first mounted', async () => {
    setupExplore({ searchParams: 'from=1&to=2&orgId=1' });
    await waitForExplore();

    expect(locationService.getSearchObject()).toEqual(expect.not.objectContaining({ from: '1', to: '2' }));
    expect(locationService.getSearchObject()).toEqual(expect.objectContaining({ orgId: '1' }));
  });
});
