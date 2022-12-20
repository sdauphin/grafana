import { css } from '@emotion/css';
import React, { CSSProperties } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import { SceneEditor, SceneObject } from '../core/types';

export function SceneComponentEditWrapper({
  model,
  editor,
  children,
}: {
  model: SceneObject;
  editor: SceneEditor;
  children: React.ReactNode;
}) {
  const styles = useStyles2(getStyles);
  const { hoverObject, selectedObject } = editor.useState();

  const onMouseEnter = () => editor.onMouseEnterObject(model);
  const onMouseLeave = () => editor.onMouseLeaveObject(model);

  const onClick = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    editor.onSelectObject(model);
  };

  const style: CSSProperties = {};
  let className = styles.wrapper;

  if (hoverObject?.ref === model) {
    className += ' ' + styles.hover;
  }
  if (selectedObject?.ref === model) {
    className += ' ' + styles.selected;
  }

  return (
    <div style={style} className={className} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onClick={onClick}>
      {children}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => {
  return {
    wrapper: css({
      display: 'flex',
      flexGrow: 1,
      padding: 8,
      border: `1px dashed ${theme.colors.primary.main}`,
      cursor: 'pointer',
      position: 'relative',
    }),
    hover: css({
      border: `1px solid ${theme.colors.primary.border}`,
    }),
    selected: css({
      border: `1px solid ${theme.colors.error.border}`,
    }),
  };
};
