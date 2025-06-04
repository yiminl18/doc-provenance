"""
Connect to Google Drive so that we can download the PDFs from the Google Drive folder and upload them to DocumentCloud.

To set up:
First enable the Google Drive API in the Google Cloud Console:
https://console.cloud.google.com/apis/api/drive.googleapis.com
Or here: https://console.cloud.google.com/workspace-api

Then create OAuth 2.0 credentials:
https://console.cloud.google.com/apis/credentials/wizard
"""
import csv
import hashlib
import io
import os
from time import sleep
import tempfile
from tempfile import TemporaryDirectory

from googleapiclient.discovery import build, Resource
from google_auth_oauthlib.flow import Flow
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload
from google.oauth2.credentials import Credentials
from tenacity import retry, wait_fixed, stop_after_attempt

from dataclasses import dataclass
from urllib.parse import urlparse, parse_qs
from dotenv import dotenv_values

env_config = dotenv_values(".env")

GOOGLE_CLIENT_ID = env_config["GOOGLE_CLIENT_ID"]
GOOGLE_CLIENT_SECRET = env_config["GOOGLE_CLIENT_SECRET"]
GOOGLE_REDIRECT_URI = env_config["GOOGLE_REDIRECT_URI"]
CASE_FILES_FOLDER_ID = env_config['CASE_FILES_FOLDER_ID']

# Scopes required by the application
SCOPES = ['https://www.googleapis.com/auth/drive']


def extract_auth_code(url):
    """Extract the authorization code from the URL. So the user doesn't have to figure out how to extract it from the
    URL."""
    parsed_url = urlparse(url)
    query_string = parse_qs(parsed_url.query)
    auth_code = query_string.get('code', [])

    if auth_code:
        return auth_code[0]
    else:
        return None

@dataclass
class GetAutofolioWorksheetForAgencyResult:
    autofolio_worksheet_id: str
    autofolio_worksheet_name: str

class GoogleService:
    def __init__(self, service_name, version):
        self.service_name = service_name
        self.version = version
        self.service = None
        self.auth_flow = None

    def connect(self):
        # Try to load saved credentials
        if os.path.exists('token.json'):
            creds = Credentials.from_authorized_user_file('token.json', SCOPES)
            self.service = build(self.service_name, self.version, credentials=creds)
        else:
            # If there are no credentials available, let the user log in.
            self.auth_flow = Flow.from_client_config(
                client_config={
                    "web": {
                        "client_id": GOOGLE_CLIENT_ID,
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                        "client_secret": GOOGLE_CLIENT_SECRET,
                        "redirect_uris": [GOOGLE_REDIRECT_URI],
                    }
                },
                scopes=SCOPES)
            self.auth_flow.redirect_uri = GOOGLE_REDIRECT_URI

            auth_url, _ = self.auth_flow.authorization_url(
                prompt='consent',
                access_type='offline',
            )

            # If not self.service, ask for authorization
            if not self.service:
                print('Please go to this URL and authorize access:', auth_url)
                code = input("Enter the full URL of the page you're redirected to after granting permissions: ")
                code = extract_auth_code(code)
                self.submit_auth_code(code)

            return auth_url

    def submit_auth_code(self, auth_code):
        self.auth_flow.fetch_token(code=auth_code)

        # Save the credentials for the next run
        creds = self.auth_flow.credentials
        with open('token.json', 'w') as token_file:
            token_file.write(creds.to_json())

        self.service = build(self.service_name, self.version, credentials=creds)


@dataclass
class GoogleDriveFileInfo:
    id: str
    name: str
    mimeType: str
    parents: list
    sha1_provided: str = None
    sha1_calculated: str = None
    relative_path: str = None
    documentcloud_url: str = None

    @property
    def sha1(self):
        """Return the SHA1 checksum of the file. Even if Google didn't provide it."""
        if self.sha1_provided:
            return self.sha1_provided
        elif self.sha1_calculated:
            return self.sha1_calculated
        elif 'google' in self.mimeType:
            raise Exception(f'cannot get sha1 hash of {self.mimeType} files')
        else:
            cache_key = f"gdrive_file_sha1:{self.id}"
            cached_sha1 = None
            if cached_sha1:
                self.sha1_calculated = cached_sha1
                return cached_sha1
            else:
                gdrive_service = GoogleDrive()
                gdrive_service.connect()
                with TemporaryDirectory() as temp_dir:
                    destination_file_name = os.path.join(temp_dir, self.id)
                    gdrive_service.download_file(self, destination_file_name)
                    # Calculate the SHA1 hash of the downloaded file
                    with open(destination_file_name, 'rb') as f:
                        file_hash = hashlib.sha1(f.read()).hexdigest()
                self.sha1_calculated = file_hash
            return file_hash

    def __repr__(self):
        return f"{self.id}\t\t{self.sha1}\t\t{self.relative_path}/{self.name}\t\t{self.mimeType}"


class FolderNameContainsSingleQuoteError(Exception):
    pass


class GoogleDrive(GoogleService):
    def __init__(self):
        super().__init__('drive', 'v3')

    @staticmethod
    def url_to_id(url):
        if url.startswith("https://drive.google.com/file/d/"):
            return(url.split('file/d/')[1].split('/')[0])

    def get_account_info(self):
        return self.service.about().get(fields="storageQuota,user(displayName,emailAddress)").execute()

    def search(self, query):
        page_token = None
        found_files = []

        while True:
            response = self.service.files().list(
                q="trashed=false and " + query,
                pageSize=1000,
                spaces='drive',
                fields='nextPageToken, files(id, name, mimeType, parents, sha1Checksum)',
                pageToken=page_token
            ).execute()
            found_sheets_count = len(response.get('files', []))
            found_files.extend(response.get('files', []))
            page_token = response.get('nextPageToken', None)
            if page_token is None:
                break
            sleep(1)  # Pause between API calls to manage API rate limits

        return found_files

    def list_files_in_folder_recursive(self, folder_id, file_list, path_stack) -> list[GoogleDriveFileInfo]:
        """Recursively list all files in a Google Drive folder and its subfolders, recording the file's path."""
        items = []
        page_token = None
        while True:
            response = self.service.files().list(
                q=f"trashed=false and '{folder_id}' in parents",
                pageSize=1000,
                spaces='drive',
                fields='nextPageToken, files(id, name, mimeType, parents, sha1Checksum)',
                pageToken=page_token
            ).execute()
            items.extend(response.get('files', []))
            page_token = response.get('nextPageToken', None)
            if page_token is None:
                break
            sleep(1)  # Pause between API calls to manage API rate limits

        for item in items:
            # Construct the item's path by joining all folder names in the path_stack
            item_path = '/'.join(path_stack)

            if item['mimeType'] == 'application/vnd.google-apps.folder':
                # It's a folder, so add its name to the path_stack and recurse
                path_stack.append(item['name'].strip())

                #
                #            **LATHER RINSE REPEAT**
                #
                self.list_files_in_folder_recursive(item['id'], file_list, path_stack)

                # Once we're done with this folder, pop it off the stack to go back up the hierarchy
                path_stack.pop()
            else:
                # It's a file, so add its details along with its path to the file_list
                file_list.append(
                    GoogleDriveFileInfo(
                        id=item['id'],
                        name=item['name'],
                        mimeType=item['mimeType'],
                        parents=item['parents'],
                        sha1_provided=item.get('sha1Checksum', None),
                        relative_path=item_path
                    )
                )

        return file_list

    def download_pdf_file(self, file: GoogleDriveFileInfo, file_path) -> None:
        # We only want PDFs
        if file.mimeType.startswith('application/pdf'):
            # Check if the file already exists
            # Makes runs go quicker when using persistent tempdir provided by the user
            if os.path.exists(file_path):
                return

            request = self.service.files().get_media(fileId=file.id)
            try:
                with open(file_path, 'wb') as fh:
                    downloader = MediaIoBaseDownload(fh, request)
                    done = False
                    while not done:
                        status, done = downloader.next_chunk()
            except Exception as e:
                print(f"Error downloading file {file.name} ({file.id}): {e}")
        else:
            print(f"Skipping '{file.name}' ({file.id}) because it's not a PDF.")

    @retry(wait=wait_fixed(2), stop=stop_after_attempt(5))
    def get_file_info(self, file_id):
        # https://developers.google.com/drive/api/reference/rest/v3/files#File

        result = self.service.files().get(fileId=file_id, fields="id, name, mimeType, parents, sha1Checksum").execute()

        try:
            parents = result['parents']
        except KeyError:
            raise KeyError(f"Could not access parent folders for file '{result['name']}' ({result['id']}). Permissions issue?")
        return GoogleDriveFileInfo(
            id=result['id'],
            name=result['name'],
            sha1_provided=result.get('sha1Checksum', None),
            mimeType=result['mimeType'],
            parents=result['parents']
        )

    def _accumulate_batch(self, request_id, result, exception, results):
        if exception is not None:
            raise exception
        else:
            results.append(GoogleDriveFileInfo(
                id=result['id'],
                name=result['name'],
                sha1_provided=result.get('sha1Checksum', None),
                mimeType=result['mimeType'],
                parents=result['parents']))


    def batch_get_file_info(self, gdrive_ids : [str]) -> [GoogleDriveFileInfo]:
        results = []
        batched_ids = [gdrive_ids[i:i + 100] for i in range(0, len(gdrive_ids), 100)]
        for id_batch in batched_ids:
            batch = self.service.new_batch_http_request()
            for gdrive_id in id_batch:
                batch.add(self.service.files().get(fileId=gdrive_id, fields="id,name,mimeType,parents,sha1Checksum"),
                          callback=lambda rec,res,exc: self._accumulate_batch(rec,res,exc, results))
            sleep(1)
            batch.execute()
        return results

    def convert_agency_folder_name_to_id(self, agency_folder_name, parent_folder_id=CASE_FILES_FOLDER_ID):

        if "'" in agency_folder_name:
            raise FolderNameContainsSingleQuoteError(f"Folder name cannot contain apostrophes / single quotes. "
                                                     f": \"{agency_folder_name}\"")

        def list_folders_in_folder_recursive(folder_id, folder_list, path_stack, max_depth=3) -> \
        list[GoogleDriveFileInfo]:
            # TODO: Merge this code with the function above called list_files_in_folder_recursive()?
            """Recursively list all folders in a Google Drive folder and its subfolders, recording the folder's path."""
            # print(f"#### Current stack depth: {len(path_stack)}")
            results = self.service.files().list(
                q=f"'{folder_id}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'",
                pageSize=1000,
                fields="nextPageToken, files(id, name, mimeType, parents)").execute()
            items = results.get('files', [])

            for item in items:
                # Construct the item's path by joining all folder names in the path_stack
                item_path = '/'.join(path_stack)

                path_stack.append(item['name'].strip())
                folder_list.append(
                    GoogleDriveFileInfo(
                        id=item['id'],
                        name=item['name'],
                        mimeType=item['mimeType'],
                        parents=item['parents'],
                        relative_path=item_path
                    )
                )
                # print(f"Indexed '{item['name']}' with ID '{item['id']}'")

                if len(path_stack) >= max_depth:
                    # print(f"Reached max depth of {max_depth} in folder '{item['name']}'")
                    path_stack.pop()
                    continue
                else:
                    list_folders_in_folder_recursive(item['id'], folder_list, path_stack)
                    # Once we're done with this folder, pop it off the stack to go back up the hierarchy
                    path_stack.pop()

            return folder_list

        parent_folder_name = self.service.files().get(fileId=parent_folder_id).execute()['name']
        all_folders = None
        all_folders = list_folders_in_folder_recursive(parent_folder_id, [], [parent_folder_id, ])
        for folder in all_folders:
            folder_name = folder.name.strip()
            if folder_name == agency_folder_name:
                return folder.id
            else:
                pass
        raise Exception(f"Agency folder name \"{agency_folder_name}\" could not be found. Check the spelling and try again.")
