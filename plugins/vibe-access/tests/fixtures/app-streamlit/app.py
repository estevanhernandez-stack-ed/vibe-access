import streamlit as st

from modes.alpha_mode import render_alpha_mode
from modes.beta_mode import render_beta_mode

st.set_page_config(page_title="Fixture App")


def render_main(mode):
    if mode == "Alpha Mode":
        render_alpha_mode(st.session_state)
    elif mode == "Beta Mode":
        render_beta_mode(st.session_state)


mode = st.session_state.get("search_mode", "Alpha Mode")
render_main(mode)
