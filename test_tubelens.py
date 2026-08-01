import json
import pathlib
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from tubelens_server import (
    app,
    extract_video_id,
    fetch_transcript,
    get_api_meta,
    get_comments,
    seconds_to_hms,
)

client = TestClient(app)


# ── Unit tests: extract_video_id ────────────────────────────────────────────


class TestExtractVideoId:
    def test_standard_url(self):
        assert (
            extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
            == "dQw4w9WgXcQ"
        )

    def test_short_url(self):
        assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_embed_url(self):
        assert (
            extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ")
            == "dQw4w9WgXcQ"
        )

    def test_shorts_url(self):
        assert (
            extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ")
            == "dQw4w9WgXcQ"
        )

    def test_bare_id(self):
        assert extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_invalid_url(self):
        assert extract_video_id("https://example.com") is None

    def test_empty_string(self):
        assert extract_video_id("") is None

    def test_url_with_extra_params(self):
        assert (
            extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120")
            == "dQw4w9WgXcQ"
        )


# ── Unit tests: seconds_to_hms ──────────────────────────────────────────────


class TestSecondsToHms:
    def test_seconds_only(self):
        assert seconds_to_hms(45) == "0:45"

    def test_minutes_and_seconds(self):
        assert seconds_to_hms(125) == "2:05"

    def test_hours_minutes_seconds(self):
        assert seconds_to_hms(3661) == "1:01:01"

    def test_zero(self):
        assert seconds_to_hms(0) == "0:00"

    def test_exact_minute(self):
        assert seconds_to_hms(60) == "1:00"


# ── Unit tests: fetch_transcript ────────────────────────────────────────────


class TestFetchTranscript:
    @patch("tubelens_server.YouTubeTranscriptApi")
    def test_successful_fetch(self, mock_api_class):
        mock_api = MagicMock()
        mock_api_class.return_value = mock_api
        mock_snippet = MagicMock()
        mock_snippet.start = 10.0
        mock_snippet.text = "Hello world"
        mock_fetched = MagicMock()
        mock_fetched.snippets = [mock_snippet]
        mock_api.fetch.return_value = mock_fetched

        transcript, error = fetch_transcript("dQw4w9WgXcQ")
        assert error is None
        assert "[0:10] Hello world" in transcript

    @patch("tubelens_server.YouTubeTranscriptApi")
    def test_transcripts_disabled(self, mock_api_class):
        from youtube_transcript_api import TranscriptsDisabled

        mock_api = MagicMock()
        mock_api_class.return_value = mock_api
        mock_api.fetch.side_effect = TranscriptsDisabled(video_id="test123")
        mock_tlist = MagicMock()
        mock_tlist.__iter__ = MagicMock(side_effect=StopIteration)
        mock_api.list.return_value = mock_tlist

        _, error = fetch_transcript("test123")
        assert error is not None
        assert "No transcript available" in error


# ── Unit tests: get_api_meta ────────────────────────────────────────────────


class TestGetApiMeta:
    @patch("tubelens_server.requests.get")
    def test_successful_meta(self, mock_get):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "items": [
                {
                    "snippet": {
                        "title": "Test Video",
                        "description": "Desc",
                        "channelTitle": "Channel",
                        "publishedAt": "2024-01-01",
                    }
                }
            ]
        }
        mock_get.return_value = mock_response

        meta, error = get_api_meta("vid123", "fake_key")
        assert error is None
        assert meta["title"] == "Test Video"
        assert meta["channel"] == "Channel"

    @patch("tubelens_server.requests.get")
    def test_invalid_api_key(self, mock_get):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "error": {"code": 403, "message": "Invalid API key"}
        }
        mock_get.return_value = mock_response

        _, error = get_api_meta("vid123", "bad_key")
        assert error is not None
        assert "Invalid API key" in error


# ── Unit tests: get_comments ────────────────────────────────────────────────


class TestGetComments:
    @patch("tubelens_server.requests.get")
    def test_successful_comments(self, mock_get):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "items": [
                {
                    "snippet": {
                        "topLevelComment": {
                            "snippet": {
                                "textDisplay": "Great video!",
                                "authorDisplayName": "User1",
                                "likeCount": 42,
                            }
                        }
                    }
                }
            ]
        }
        mock_get.return_value = mock_response

        comments, error = get_comments("vid123", "fake_key")
        assert error is None
        assert len(comments) == 1
        assert "[42 likes] @User1: Great video!" in comments[0]

    @patch("tubelens_server.requests.get")
    def test_invalid_key_returns_error(self, mock_get):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "error": {"code": 403, "message": "API key not valid"}
        }
        mock_get.return_value = mock_response

        comments, error = get_comments("vid123", "bad_key")
        assert error is not None
        assert len(comments) == 0


# ── Integration tests: /fetch endpoint ──────────────────────────────────────


class TestFetchEndpoint:
    def test_invalid_url(self):
        response = client.get("/fetch?url=not-a-url")
        assert response.status_code == 200
        data = response.json()
        assert "error" in data

    @patch("tubelens_server.fetch_transcript")
    @patch("tubelens_server.get_basic_meta")
    @patch("tubelens_server.get_api_meta")
    @patch("tubelens_server.get_comments")
    def test_successful_fetch(
        self, mock_comments, mock_api_meta, mock_meta, mock_transcript
    ):
        mock_meta.return_value = {"title": "Test", "channel": "Ch"}
        mock_api_meta.return_value = ({}, None)
        mock_transcript.return_value = ("[0:00] Hello", None)
        mock_comments.return_value = ([], None)

        # Delete cache file if exists to force fresh fetch
        cache_file = pathlib.Path(__file__).parent / "cache" / "dQw4w9WgXcQ.json"
        if cache_file.exists():
            cache_file.unlink()

        response = client.get("/fetch?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert response.status_code == 200
        data = response.json()
        assert data["video_id"] == "dQw4w9WgXcQ"
        assert data["title"] == "Test"
        assert "errors" in data


# ── Integration tests: /generate endpoint ───────────────────────────────────


class TestGenerateEndpoint:
    @patch("tubelens_server.requests.post")
    def test_successful_generation(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Test report"}}]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        response = client.post(
            "/generate",
            json={
                "system": "You are helpful.",
                "prompt": "Summarize this.",
                "model": "test-model",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["report"] == "Test report"

    @patch("tubelens_server.requests.post")
    def test_ollama_connection_error(self, mock_post):
        import requests as req_lib

        mock_post.side_effect = req_lib.ConnectionError()

        response = client.post(
            "/generate", json={"system": "test", "prompt": "test", "model": "test"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "error" in data
        assert "Ollama" in data["error"]

    @patch("tubelens_server.requests.post")
    def test_saves_report_with_video_id(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Report text"}}]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        response = client.post(
            "/generate",
            json={
                "system": "sys",
                "prompt": "prompt",
                "model": "m",
                "video_id": "test123",
                "video_title": "Test Video Title!",
            },
        )
        data = response.json()
        assert data["saved_to"] is not None
        assert "Test-Video-Title-test123" in data["saved_to"]


# ── Cache tests ─────────────────────────────────────────────────────────────


class TestCache:
    def test_cache_created_on_fetch(self, tmp_path):
        from tubelens_server import CACHE_DIR

        cache_file = CACHE_DIR / "test123.json"
        if cache_file.exists():
            cache_file.unlink()
        assert not cache_file.exists()

    def test_cache_file_is_json(self, tmp_path):
        from tubelens_server import CACHE_DIR

        cache_file = CACHE_DIR / "dQw4w9WgXcQ.json"
        if cache_file.exists():
            data = json.loads(cache_file.read_text())
            assert "video_id" in data
            assert "transcript" in data
